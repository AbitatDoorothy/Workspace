import { createHash } from "node:crypto";
import { basename, normalize } from "node:path";

import type { CodexModelOption, ConversationStatus } from "@abitat_reece/shared";
import WebSocket from "ws";

const CODEX_PROJECT_PREFIX = "codex_project_";
const CODEX_THREAD_PREFIX = "codex_thread_";
const DEFAULT_CODEX_APP_SERVER_URL = "ws://127.0.0.1:47777";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_SYNCED_THREADS = 80;
const MAX_MESSAGE_CONTENT_LENGTH = 12_000;

let nextRequestId = 1;

interface JsonRpcMessage {
  id: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

interface CodexAppThread {
  id: string;
  preview: string;
  ephemeral: boolean;
  createdAt: number;
  updatedAt: number;
  status: { type?: string } | string;
  cwd: string;
  name: string | null;
  turns: CodexAppTurn[];
}

interface CodexAppTurn {
  id: string;
  items: CodexAppThreadItem[];
  status: unknown;
  error: unknown | null;
  startedAt: number | null;
  completedAt: number | null;
}

type CodexAppThreadItem =
  | { type: "userMessage"; id: string; content: Array<{ text?: string; type?: string }> }
  | { type: "agentMessage"; id: string; text: string }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; content?: string[]; summary?: string[] }
  | {
      type: "commandExecution";
      id: string;
      aggregatedOutput?: string | null;
      command?: string;
      status?: string;
    }
  | { type: string; id?: string };

interface CodexAppThreadListResponse {
  data: CodexAppThread[];
  nextCursor: string | null;
}

export interface CodexHostSnapshot {
  completions: unknown[];
  conversations: unknown[];
  messages: Record<string, unknown[]>;
  models: CodexModelOption[];
  projects: unknown[];
  syncedAt: string;
}

export async function collectCodexAppSnapshot(
  serverUrl = process.env.CODEX_APP_SERVER_URL ?? DEFAULT_CODEX_APP_SERVER_URL
): Promise<CodexHostSnapshot> {
  const client = new CodexSnapshotClient(serverUrl);
  const listedThreads = (await client.listAllThreads()).slice(0, MAX_SYNCED_THREADS);
  const threads = await Promise.all(
    listedThreads.map((thread) => client.readThread(thread.id).catch(() => thread))
  );
  const models = await client.listModels().catch(() => []);

  return snapshotFromThreads(threads, models);
}

function snapshotFromThreads(threads: CodexAppThread[], models: CodexModelOption[]) {
  const projectMap = new Map<string, { cwd: string; count: number; latestUpdatedAt: number }>();
  const conversations = threads
    .filter((thread) => !thread.ephemeral && thread.cwd)
    .sort(
      (left, right) =>
        safeSeconds(right.updatedAt, right.createdAt) - safeSeconds(left.updatedAt, left.createdAt)
    )
    .map((thread) => codexThreadToConversation(thread));
  const messages = Object.fromEntries(
    threads.map((thread) => [externalCodexConversationId(thread.id), flattenThreadMessages(thread)])
  );
  const completions = threads.map(codexThreadToCompletionState);

  for (const thread of threads) {
    if (thread.ephemeral || !thread.cwd) {
      continue;
    }

    const current = projectMap.get(thread.cwd);
    projectMap.set(thread.cwd, {
      count: (current?.count ?? 0) + 1,
      cwd: thread.cwd,
      latestUpdatedAt: Math.max(current?.latestUpdatedAt ?? thread.updatedAt, thread.updatedAt)
    });
  }

  return {
    completions,
    conversations,
    messages,
    models,
    projects: [...projectMap.values()]
      .sort((left, right) => right.latestUpdatedAt - left.latestUpdatedAt)
      .map((project) => ({
        conversationCount: project.count,
        createdByUserId: "user_demo",
        hostLocalPath: project.cwd,
        id: externalCodexProjectId(project.cwd),
        name: projectNameFromCwd(project.cwd),
        repoSyncStatus: "codex_app",
        repoUrl: project.cwd,
        source: "codex_app",
        updatedAt: secondsToIso(project.latestUpdatedAt),
        workspaceId: "workspace_demo"
      })),
    syncedAt: new Date().toISOString()
  };
}

class CodexSnapshotClient {
  constructor(private readonly serverUrl: string) {}

  async listAllThreads() {
    const stateDbThreads = await this.listAllThreadsOnce(true);

    if (stateDbThreads.length > 0) {
      return stateDbThreads;
    }

    return this.listAllThreadsOnce(false);
  }

  private async listAllThreadsOnce(useStateDbOnly: boolean) {
    let threads: CodexAppThread[] = [];
    let cursor: string | null = null;

    do {
      const page: CodexAppThreadListResponse = await this.call("thread/list", {
        archived: false,
        cursor,
        limit: 200,
        sortDirection: "desc",
        useStateDbOnly
      });

      threads = threads.concat(
        page.data.filter((thread: CodexAppThread) => !thread.ephemeral && thread.cwd)
      );
      cursor = page.nextCursor;
    } while (cursor);

    return threads;
  }

  async readThread(threadId: string) {
    const response: { thread: CodexAppThread } = await this.call("thread/read", {
      includeTurns: true,
      threadId
    });

    return response.thread;
  }

  async listModels() {
    const models: CodexModelOption[] = [];
    let cursor: string | null = null;

    do {
      const response: {
        data: Array<Record<string, unknown>>;
        nextCursor: string | null;
      } = await this.call("model/list", {
        cursor,
        includeHidden: false,
        limit: 200
      });

      models.push(...response.data.flatMap(normalizeCodexModel));
      cursor = response.nextCursor;
    } while (cursor);

    return models;
  }

  private async call<TResult>(method: string, params: unknown): Promise<TResult> {
    const connection = await JsonRpcConnection.connect(this.serverUrl);

    try {
      await connection.call("initialize", {
        capabilities: {
          experimentalApi: true
        },
        clientInfo: {
          name: "abitat-host-daemon",
          version: "0.1.1"
        }
      });
      connection.notify("initialized");

      return await connection.call<TResult>(method, params);
    } finally {
      connection.close();
    }
  }
}

class JsonRpcConnection {
  private readonly pending = new Map<
    number,
    { reject(error: Error): void; resolve(value: unknown): void; timer: NodeJS.Timeout }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString()));
    socket.on("close", () => this.rejectAll(new Error("Codex app-server connection closed")));
    socket.on("error", (error) =>
      this.rejectAll(error instanceof Error ? error : new Error(String(error)))
    );
  }

  static connect(serverUrl: string) {
    return new Promise<JsonRpcConnection>((resolve, reject) => {
      const socket = new WebSocket(serverUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to Codex app-server at ${serverUrl}`));
      }, REQUEST_TIMEOUT_MS);

      socket.once("open", () => {
        clearTimeout(timer);
        resolve(new JsonRpcConnection(socket));
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  call<TResult = unknown>(method: string, params: unknown): Promise<TResult> {
    const id = nextRequestId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server response to ${method}`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();

      this.pending.set(id, {
        reject,
        resolve: (value) => resolve(value as TResult),
        timer
      });
      this.socket.send(payload, (error) => {
        if (!error) {
          return;
        }

        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method: string, params?: unknown) {
    this.socket.send(JSON.stringify(params === undefined ? { method } : { method, params }));
  }

  close() {
    this.socket.close();
  }

  private handleMessage(raw: string) {
    let message: JsonRpcMessage;

    try {
      message = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return;
    }

    if (!("id" in message) || !("result" in message || "error" in message)) {
      return;
    }

    const id = typeof message.id === "number" ? message.id : Number(message.id);
    const pending = this.pending.get(id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (message.error) {
      pending.reject(new Error(message.error.message ?? "Codex app-server request failed"));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function codexThreadToConversation(thread: CodexAppThread) {
  return {
    agentId: "codex_app",
    branchName: null,
    codexDeepLink: `codex://threads/${thread.id}`,
    createdAt: secondsToIso(thread.createdAt),
    createdByUserId: "user_demo",
    id: externalCodexConversationId(thread.id),
    projectId: externalCodexProjectId(thread.cwd),
    prompt: codexThreadTitle(thread),
    runtimeSessionId: thread.id,
    source: "codex_app",
    status: codexThreadToConversationStatus(thread),
    type: "investigation",
    updatedAt: secondsToIso(safeSeconds(thread.updatedAt, thread.createdAt)),
    workspaceId: "workspace_demo",
    worktreePath: thread.cwd
  };
}

function codexThreadToCompletionState(thread: CodexAppThread) {
  const latestTurn = thread.turns.at(-1) ?? null;
  const status = codexThreadToConversationStatus(thread);
  const failed = Boolean(latestTurn?.error) || Boolean(latestTurn && isTurnInterrupted(latestTurn));
  const latestTurnCompletedAt = latestTurnCompletedAtIso(thread, latestTurn);
  const latestTurnFinished = Boolean(latestTurn && isTurnTerminal(latestTurn));

  return {
    conversationId: externalCodexConversationId(thread.id),
    failed,
    isComplete: Boolean(
      latestTurn?.id &&
      (latestTurnCompletedAt || latestTurnFinished || failed) &&
      status !== "running"
    ),
    latestTurnCompletedAt,
    latestTurnId: latestTurn?.id ?? null,
    projectId: externalCodexProjectId(thread.cwd),
    projectName: projectNameFromCwd(thread.cwd),
    prompt: codexThreadTitle(thread),
    source: "codex_app",
    status,
    updatedAt: secondsToIso(safeSeconds(thread.updatedAt, thread.createdAt)),
    workspaceId: "workspace_demo"
  };
}

function flattenThreadMessages(thread: CodexAppThread) {
  const conversationId = externalCodexConversationId(thread.id);
  const messages: unknown[] = [];
  const itemOccurrences = new Map<string, number>();
  let sequence = 1;

  for (const turn of thread.turns) {
    for (const [itemIndex, item] of turn.items.entries()) {
      const flattened = threadItemToMessageContent(item);

      if (!flattened) {
        continue;
      }

      const codexItemId = item.id ?? `item_${itemIndex}`;
      const occurrenceKey = `${turn.id}:${codexItemId}`;
      const occurrence = (itemOccurrences.get(occurrenceKey) ?? 0) + 1;
      itemOccurrences.set(occurrenceKey, occurrence);

      messages.push({
        content: flattened.content,
        conversationId,
        createdAt: itemCreatedAt(thread, turn, sequence),
        id: `${conversationId}_${encodeURIComponent(turn.id)}_${encodeURIComponent(codexItemId)}`,
        metadata: {
          codexItemId,
          codexItemOccurrence: occurrence,
          codexItemType: item.type,
          codexThreadId: thread.id,
          codexTurnId: turn.id
        },
        role: flattened.role,
        sequence,
        sourceDeviceId: null
      });
      sequence += 1;
    }
  }

  return messages;
}

function threadItemToMessageContent(item: CodexAppThreadItem) {
  if (item.type === "userMessage") {
    const userItem = item as Extract<CodexAppThreadItem, { type: "userMessage" }>;
    const content = userItem.content
      .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();

    return content ? { content: truncateMessageContent(content), role: "user" } : null;
  }

  if (item.type === "agentMessage") {
    const agentItem = item as Extract<CodexAppThreadItem, { type: "agentMessage" }>;
    return agentItem.text
      ? { content: truncateMessageContent(agentItem.text), role: "assistant" }
      : null;
  }

  if (item.type === "plan") {
    const planItem = item as Extract<CodexAppThreadItem, { type: "plan" }>;
    return planItem.text
      ? { content: truncateMessageContent(planItem.text), role: "assistant" }
      : null;
  }

  if (item.type === "reasoning") {
    const reasoningItem = item as Extract<CodexAppThreadItem, { type: "reasoning" }>;
    const content = [...(reasoningItem.summary ?? []), ...(reasoningItem.content ?? [])]
      .join("\n")
      .trim();
    return content ? { content: truncateMessageContent(content), role: "runtime" } : null;
  }

  if (item.type === "commandExecution") {
    const commandItem = item as Extract<CodexAppThreadItem, { type: "commandExecution" }>;
    const content = [commandItem.command, commandItem.aggregatedOutput]
      .filter(Boolean)
      .join("\n")
      .trim();
    return content ? { content: truncateMessageContent(content), role: "runtime" } : null;
  }

  return null;
}

function truncateMessageContent(content: string) {
  if (content.length <= MAX_MESSAGE_CONTENT_LENGTH) {
    return content;
  }

  return `${content.slice(0, MAX_MESSAGE_CONTENT_LENGTH)}\n\n[truncated for mobile sync]`;
}

function codexThreadToConversationStatus(thread: CodexAppThread): ConversationStatus {
  if (threadStatusType(thread.status) === "active" && isCodexThreadBusy(thread)) {
    return "running";
  }

  const latestTurn = thread.turns.at(-1) ?? null;
  if (latestTurn?.error || (latestTurn && isTurnInterrupted(latestTurn))) {
    return "failed";
  }

  return "approved";
}

function isCodexThreadBusy(thread: CodexAppThread) {
  const latestTurn = thread.turns.at(-1) ?? null;
  return !(latestTurn && isTurnTerminal(latestTurn));
}

function isTurnTerminal(turn: CodexAppTurn) {
  return isTurnCompleted(turn) || isTurnInterrupted(turn);
}

function isTurnCompleted(turn: CodexAppTurn) {
  return turnStatusType(turn) === "completed";
}

function isTurnInterrupted(turn: CodexAppTurn) {
  return turnStatusType(turn) === "interrupted";
}

function latestTurnCompletedAtIso(thread: CodexAppThread, turn: CodexAppTurn | null) {
  if (!turn) {
    return null;
  }

  if (typeof turn.completedAt === "number" && Number.isFinite(turn.completedAt)) {
    return secondsToIso(turn.completedAt);
  }

  if (isTurnTerminal(turn) && Number.isFinite(thread.updatedAt)) {
    return secondsToIso(thread.updatedAt);
  }

  return null;
}

function turnStatusType(turn: CodexAppTurn) {
  if (typeof turn.status === "string") {
    return turn.status;
  }

  if (turn.status && typeof turn.status === "object") {
    return (turn.status as { type?: unknown }).type;
  }

  return null;
}

function threadStatusType(status: CodexAppThread["status"]) {
  return typeof status === "string" ? status : status.type;
}

function itemCreatedAt(thread: CodexAppThread, turn: CodexAppTurn, sequence: number) {
  const seconds =
    typeof turn.completedAt === "number"
      ? turn.completedAt
      : typeof turn.startedAt === "number"
        ? turn.startedAt
        : safeSeconds(thread.updatedAt, thread.createdAt) + sequence / 1000;

  return secondsToIso(seconds);
}

function codexThreadTitle(thread: CodexAppThread) {
  return thread.name?.trim() || thread.preview?.trim() || "Codex conversation";
}

function externalCodexProjectId(cwd: string) {
  return `${CODEX_PROJECT_PREFIX}${createHash("sha256").update(normalize(cwd)).digest("hex").slice(0, 16)}`;
}

function externalCodexConversationId(threadId: string) {
  return `${CODEX_THREAD_PREFIX}${encodeURIComponent(threadId)}`;
}

function projectNameFromCwd(cwd: string) {
  return basename(cwd) || cwd;
}

function secondsToIso(seconds: number) {
  return new Date(safeSeconds(seconds) * 1000).toISOString();
}

function safeSeconds(value: number, fallback = Date.now() / 1000) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeCodexModel(raw: Record<string, unknown>): CodexModelOption[] {
  if (raw.hidden) {
    return [];
  }

  const id = stringValue(raw.id) || stringValue(raw.model);
  if (!id) {
    return [];
  }

  const defaultReasoningEffort = reasoningEffort(raw.defaultReasoningEffort) ?? "medium";
  const supportedReasoningEfforts = uniqueReasoningEfforts(raw.supportedReasoningEfforts);

  return [
    {
      defaultReasoningEffort,
      description: stringValue(raw.description),
      displayName: stringValue(raw.displayName) || id,
      id,
      isDefault: raw.isDefault === true,
      supportedReasoningEfforts:
        supportedReasoningEfforts.length > 0 ? supportedReasoningEfforts : [defaultReasoningEffort]
    }
  ];
}

function uniqueReasoningEfforts(input: unknown): CodexModelOption["supportedReasoningEfforts"] {
  if (!Array.isArray(input)) {
    return [];
  }

  return [
    ...new Set(
      input
        .map((item) =>
          typeof item === "string"
            ? reasoningEffort(item)
            : item && typeof item === "object"
              ? reasoningEffort((item as { reasoningEffort?: unknown }).reasoningEffort)
              : null
        )
        .filter((effort): effort is CodexModelOption["defaultReasoningEffort"] => Boolean(effort))
    )
  ];
}

function reasoningEffort(input: unknown): CodexModelOption["defaultReasoningEffort"] | null {
  return input === "none" ||
    input === "minimal" ||
    input === "low" ||
    input === "medium" ||
    input === "high" ||
    input === "xhigh"
    ? input
    : null;
}

function stringValue(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}
