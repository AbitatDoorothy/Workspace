import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, normalize } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type {
  CodexMobileModelSettings,
  CodexModelOption,
  CodexReasoningEffort,
  ConversationStatus
} from "@abitat_reece/shared";
import WebSocket from "ws";

import type {
  LocalAttachmentReference,
  LocalCodexBridge,
  LocalCodexConversationSummary,
  LocalCodexMessage,
  LocalCodexProjectSummary
} from "./server.js";

const CODEX_PROJECT_PREFIX = "codex_project_";
const CODEX_THREAD_PREFIX = "codex_thread_";
const DEFAULT_SERVER_URL = "ws://127.0.0.1:47777";
const DEFAULT_CODEX_BINARY = "/Applications/Codex.app/Contents/Resources/codex";
const REQUEST_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 15_000;
const TURN_KEEPALIVE_TIMEOUT_MS = 30 * 60_000;
const MAX_CODEX_MESSAGE_CONTENT_LENGTH = 12_000;
const PHONE_FULL_ACCESS_TURN_OPTIONS = {
  approvalPolicy: "never",
  sandboxPolicy: { type: "dangerFullAccess" }
} satisfies Pick<CodexAppStartTurnOptions, "approvalPolicy" | "sandboxPolicy">;

let spawnedAppServer: ChildProcess | null = null;
let nextRequestId = 1;
const activeTurnKeepAlives = new Set<Promise<void>>();

interface CreateLocalCodexBridgeOptions {
  serverUrl?: string;
  codexBinaryPath?: string;
  workspaceId?: string;
  userId?: string;
}

type CodexAppThreadStatus = { type?: string; activeFlags?: unknown[] } | string | null | undefined;

type CodexAppUserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "localImage"; path: string }
  | { type: "mention"; name: string; path: string };

type CodexAppResponseItem = {
  type: "message";
  role: "assistant" | "user";
  content: Array<{ type: "input_text"; text: string } | { type: "output_text"; text: string }>;
};

interface CodexAppStartTurnOptions {
  approvalPolicy?: "never";
  cwd?: string | null;
  effort?: CodexReasoningEffort;
  model?: string;
  sandboxPolicy?: { type: "dangerFullAccess" };
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
  | { type: "userMessage"; id?: string; content?: CodexAppUserInput[] }
  | { type: "agentMessage"; id?: string; text?: string }
  | { type: "plan"; id?: string; text?: string }
  | { type: "reasoning"; id?: string; content?: string[]; summary?: string[] }
  | {
      type: "commandExecution";
      id?: string;
      aggregatedOutput?: string | null;
      command?: string;
      status?: string;
    }
  | { type: "fileChange"; id?: string; changes?: unknown[]; status?: string }
  | { type: string; id?: string };

interface CodexAppThread {
  id: string;
  preview: string;
  ephemeral: boolean;
  createdAt: number;
  updatedAt: number;
  status: CodexAppThreadStatus;
  cwd: string;
  name: string | null;
  turns: CodexAppTurn[];
}

interface CodexAppThreadListParams {
  archived?: boolean;
  cursor?: string | null;
  cwd?: string | string[] | null;
  limit?: number;
  sortDirection?: "asc" | "desc";
  useStateDbOnly?: boolean;
}

interface CodexAppThreadListResponse {
  data: CodexAppThread[];
  nextCursor: string | null;
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

export class LocalCodexConversationBusyError extends Error {
  readonly statusCode = 409;

  constructor() {
    super(
      "Codex is already working on this thread. Wait for the current Mac or phone turn to finish before sending another message."
    );
    this.name = "LocalCodexConversationBusyError";
  }
}

export function createLocalCodexBridge(
  options: CreateLocalCodexBridgeOptions = {}
): LocalCodexBridge {
  const client = createCodexAppClient(options);
  const workspaceId = options.workspaceId ?? "local";
  const userId = options.userId ?? "local";

  async function listAllThreads(params: CodexAppThreadListParams = {}) {
    const stateThreads = await listAllThreadsOnce({ ...params, useStateDbOnly: true });

    if (stateThreads.length > 0 || params.useStateDbOnly !== undefined) {
      return stateThreads;
    }

    return listAllThreadsOnce({ ...params, useStateDbOnly: false });
  }

  async function listAllThreadsOnce(params: CodexAppThreadListParams) {
    const threads: CodexAppThread[] = [];
    let cursor: string | null = params.cursor ?? null;

    do {
      const page = await client.listThreads({ ...params, cursor });
      threads.push(...page.data.filter((thread) => !thread.ephemeral && thread.cwd));
      cursor = page.nextCursor;
    } while (cursor);

    return threads;
  }

  async function resolveProjectCwd(projectId: string) {
    const project = (await listProjects()).find((candidate) => candidate.id === projectId);
    if (!project) {
      throw Object.assign(new Error("Codex project not found"), { statusCode: 404 });
    }
    return project.hostLocalPath;
  }

  async function listProjects(): Promise<LocalCodexProjectSummary[]> {
    const grouped = new Map<string, { cwd: string; count: number; latestUpdatedAt: number }>();

    for (const thread of await listAllThreads()) {
      const current = grouped.get(thread.cwd);
      grouped.set(thread.cwd, {
        count: (current?.count ?? 0) + 1,
        cwd: thread.cwd,
        latestUpdatedAt: Math.max(current?.latestUpdatedAt ?? thread.updatedAt, thread.updatedAt)
      });
    }

    return Array.from(grouped.values())
      .sort((left, right) => right.latestUpdatedAt - left.latestUpdatedAt)
      .map((project) => ({
        conversationCount: project.count,
        createdByUserId: userId,
        hostLocalPath: project.cwd,
        id: externalCodexProjectId(project.cwd),
        name: projectNameFromCwd(project.cwd),
        repoSyncStatus: "codex_app",
        repoUrl: project.cwd,
        source: "codex_app",
        updatedAt: secondsToIso(project.latestUpdatedAt),
        workspaceId
      }));
  }

  return {
    async bootstrap() {
      try {
        await client.listThreads({ limit: 1, useStateDbOnly: true });
        return { available: true };
      } catch (error) {
        return { available: false, error: errorMessage(error) };
      }
    },

    async continueConversation(conversationId, input) {
      const threadId = toCodexThreadId(conversationId);
      let thread = await client.readThread(threadId, true);

      if (isCodexThreadBusy(thread)) {
        throw new LocalCodexConversationBusyError();
      }

      if (threadStatusType(thread.status) !== "active") {
        thread = (await client.resumeThread({ excludeTurns: false, threadId })).thread;
      }

      await client.startTurn(threadId, userInput(input.prompt, input.attachments), {
        ...PHONE_FULL_ACCESS_TURN_OPTIONS,
        cwd: thread.cwd,
        ...turnModelSettings(input.modelSettings)
      });

      return {
        conversationId: externalCodexConversationId(threadId),
        status: "running"
      };
    },

    async listCompletionStates() {
      const threads = await readThreadsWithTurns(await listAllThreads());
      return threads
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((thread) => codexThreadToCompletionState(thread, workspaceId));
    },

    async listMessages(conversationId, messageOptions = {}) {
      const threadId = toCodexThreadId(conversationId);
      const messages = flattenThreadMessages(
        await client.readThread(threadId, true),
        externalCodexConversationId(threadId)
      );
      const filtered = messageOptions.includeRuntime
        ? messages
        : messages.filter((message) => message.role !== "runtime");

      if (typeof messageOptions.afterSequence !== "number") {
        return filtered;
      }

      const maxSequence = filtered.reduce((max, message) => Math.max(max, message.sequence), 0);
      return messageOptions.afterSequence > maxSequence
        ? filtered
        : filtered.filter((message) => message.sequence > messageOptions.afterSequence!);
    },

    listModelOptions() {
      return client.listModels();
    },

    async listProjectConversations(projectId) {
      const cwd = await resolveProjectCwd(projectId);
      const threads = await readThreadsWithTurns(await listAllThreads({ cwd }));
      return threads
        .filter((thread) => externalCodexProjectId(thread.cwd) === projectId)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((thread) => codexThreadToConversation(thread, workspaceId, userId));
    },

    listProjects,

    async startConversation(projectId, input) {
      const cwd = await resolveProjectCwd(projectId);
      const { thread } = await client.startThread({
        cwd,
        experimentalRawEvents: false,
        persistExtendedHistory: true
      });
      await client.startTurn(thread.id, userInput(input.prompt, input.attachments), {
        ...PHONE_FULL_ACCESS_TURN_OPTIONS,
        cwd,
        ...turnModelSettings(input.modelSettings)
      });

      return {
        conversationId: externalCodexConversationId(thread.id),
        status: "running"
      };
    }
  };

  async function readThreadsWithTurns(threads: CodexAppThread[]) {
    return Promise.all(
      threads.map((thread) => client.readThread(thread.id, true).catch(() => thread))
    );
  }
}

function createCodexAppClient(options: CreateLocalCodexBridgeOptions) {
  const serverUrl = options.serverUrl ?? process.env.CODEX_APP_SERVER_URL ?? DEFAULT_SERVER_URL;
  const codexBinaryPath =
    options.codexBinaryPath ?? process.env.CODEX_APP_BINARY ?? DEFAULT_CODEX_BINARY;

  return {
    listModels: async () => {
      const models: CodexModelOption[] = [];
      let cursor: string | null = null;

      do {
        const response: { data: Array<Record<string, unknown>>; nextCursor: string | null } =
          await callCodexApp(serverUrl, codexBinaryPath, "model/list", {
            cursor,
            includeHidden: false,
            limit: 200
          });
        models.push(...response.data.flatMap(normalizeCodexModel));
        cursor = response.nextCursor;
      } while (cursor);

      return models;
    },

    listThreads: (params: CodexAppThreadListParams = {}) =>
      callCodexApp<CodexAppThreadListResponse>(serverUrl, codexBinaryPath, "thread/list", {
        archived: false,
        limit: 200,
        sortDirection: "desc",
        useStateDbOnly: true,
        ...params
      }),

    async readThread(threadId: string, includeTurns = true) {
      const response = await callCodexApp<{ thread: CodexAppThread }>(
        serverUrl,
        codexBinaryPath,
        "thread/read",
        { includeTurns, threadId }
      );
      return response.thread;
    },

    resumeThread: (params: { excludeTurns?: boolean; threadId: string }) =>
      callCodexApp<{ thread: CodexAppThread }>(serverUrl, codexBinaryPath, "thread/resume", params),

    startThread: (params: {
      cwd?: string | null;
      experimentalRawEvents?: boolean;
      persistExtendedHistory?: boolean;
    }) =>
      callCodexApp<{ thread: CodexAppThread }>(serverUrl, codexBinaryPath, "thread/start", {
        experimentalRawEvents: false,
        persistExtendedHistory: true,
        ...params
      }),

    startTurn: (
      threadId: string,
      input: CodexAppUserInput[],
      turnOptions: CodexAppStartTurnOptions
    ) => startTurnWithKeepAlive(serverUrl, codexBinaryPath, threadId, input, turnOptions)
  };
}

async function callCodexApp<TResult>(
  serverUrl: string,
  codexBinaryPath: string,
  method: string,
  params: unknown
): Promise<TResult> {
  try {
    return await callCodexAppOnce<TResult>(serverUrl, method, params);
  } catch (error) {
    if (!isConnectionFailure(error) || !canStartLocalServer(serverUrl)) {
      throw error;
    }

    await ensureLocalAppServer(serverUrl, codexBinaryPath);
    return callCodexAppOnce<TResult>(serverUrl, method, params);
  }
}

async function callCodexAppOnce<TResult>(serverUrl: string, method: string, params: unknown) {
  const connection = await JsonRpcConnection.connect(serverUrl);

  try {
    await initializeConnection(connection);
    return await connection.call<TResult>(method, params);
  } finally {
    connection.close();
  }
}

async function startTurnWithKeepAlive(
  serverUrl: string,
  codexBinaryPath: string,
  threadId: string,
  input: CodexAppUserInput[],
  options: CodexAppStartTurnOptions
) {
  try {
    return await startTurnWithKeepAliveOnce(serverUrl, threadId, input, options);
  } catch (error) {
    if (!isConnectionFailure(error) || !canStartLocalServer(serverUrl)) {
      throw error;
    }

    await ensureLocalAppServer(serverUrl, codexBinaryPath);
    return startTurnWithKeepAliveOnce(serverUrl, threadId, input, options);
  }
}

async function startTurnWithKeepAliveOnce(
  serverUrl: string,
  threadId: string,
  input: CodexAppUserInput[],
  options: CodexAppStartTurnOptions
) {
  const connection = await JsonRpcConnection.connect(serverUrl);
  let keepAliveStarted = false;

  try {
    await initializeConnection(connection);
    const response = await connection.call<{ turn: CodexAppTurn }>("turn/start", {
      ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      input,
      ...(options.model ? { model: options.model } : {}),
      ...(options.sandboxPolicy ? { sandboxPolicy: options.sandboxPolicy } : {}),
      threadId
    });

    if (isTurnInProgress(response.turn)) {
      keepAliveStarted = true;
      keepTurnConnectionAlive(connection, threadId, response.turn.id);
    }

    return response;
  } finally {
    if (!keepAliveStarted) {
      connection.close();
    }
  }
}

async function initializeConnection(connection: JsonRpcConnection) {
  await connection.call("initialize", {
    capabilities: {
      experimentalApi: true
    },
    clientInfo: {
      name: "abitat-local-control",
      version: "0.1.0"
    }
  });
  connection.notify("initialized");
}

class JsonRpcConnection {
  private readonly pending = new Map<
    number,
    { reject(error: Error): void; resolve(value: unknown): void; timer: NodeJS.Timeout }
  >();
  private readonly notificationHandlers = new Set<(method: string, params: unknown) => void>();
  private readonly closeHandlers = new Set<() => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString()));
    socket.on("close", () => {
      this.rejectAll(new Error("Codex app-server connection closed"));
      for (const handler of this.closeHandlers) {
        handler();
      }
      this.closeHandlers.clear();
    });
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

  onNotification(handler: (method: string, params: unknown) => void) {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  onClose(handler: () => void) {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  call<TResult = unknown>(
    method: string,
    params: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<TResult> {
    const id = nextRequestId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server response to ${method}`));
      }, timeoutMs);
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

    if (message.method && !("result" in message) && !("error" in message)) {
      for (const handler of this.notificationHandlers) {
        handler(message.method, message.params);
      }
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

function keepTurnConnectionAlive(connection: JsonRpcConnection, threadId: string, turnId: string) {
  let removeNotificationHandler: () => void = () => undefined;
  let removeCloseHandler: () => void = () => undefined;
  let resolveKeepAlive: () => void = () => undefined;
  const timer = setTimeout(() => resolveKeepAlive(), TURN_KEEPALIVE_TIMEOUT_MS);
  timer.unref?.();

  const keepAlive = new Promise<void>((resolve) => {
    resolveKeepAlive = resolve;
    removeNotificationHandler = connection.onNotification((method, params) => {
      if (isTurnFinishedNotification(method, params, threadId, turnId)) {
        resolve();
      }
    });
    removeCloseHandler = connection.onClose(resolve);
  }).finally(() => {
    clearTimeout(timer);
    removeNotificationHandler();
    removeCloseHandler();
    connection.close();
    activeTurnKeepAlives.delete(keepAlive);
  });

  activeTurnKeepAlives.add(keepAlive);
  void keepAlive;
}

async function ensureLocalAppServer(serverUrl: string, codexBinaryPath: string) {
  if (!spawnedAppServer || spawnedAppServer.exitCode !== null || spawnedAppServer.killed) {
    spawnedAppServer = spawn(
      codexBinaryPath,
      ["app-server", "--listen", serverUrl, "--analytics-default-enabled"],
      {
        detached: true,
        stdio: "ignore"
      }
    );
    spawnedAppServer.unref();
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (await canOpenWebSocket(serverUrl)) {
      return;
    }
    await delay(250);
  }

  throw new Error("Unable to start Codex app-server. Open Codex.app or set CODEX_APP_SERVER_URL.");
}

function canOpenWebSocket(serverUrl: string) {
  return new Promise<boolean>((resolve) => {
    const socket = new WebSocket(serverUrl);
    const timer = setTimeout(() => {
      socket.close();
      resolve(false);
    }, 1000);

    socket.once("open", () => {
      clearTimeout(timer);
      socket.close();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function canStartLocalServer(serverUrl: string) {
  try {
    const url = new URL(serverUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isConnectionFailure(error: unknown) {
  return (
    error instanceof Error &&
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|closed before|connection closed|Timed out connecting|Unexpected server response/u.test(
      error.message
    )
  );
}

function externalCodexProjectId(cwd: string) {
  return `${CODEX_PROJECT_PREFIX}${createHash("sha256").update(normalize(cwd)).digest("hex").slice(0, 16)}`;
}

function externalCodexConversationId(threadId: string) {
  return `${CODEX_THREAD_PREFIX}${encodeURIComponent(threadId)}`;
}

function toCodexThreadId(conversationId: string) {
  return conversationId.startsWith(CODEX_THREAD_PREFIX)
    ? decodeURIComponent(conversationId.slice(CODEX_THREAD_PREFIX.length))
    : conversationId;
}

function codexThreadToConversation(
  thread: CodexAppThread,
  workspaceId: string,
  userId: string
): LocalCodexConversationSummary {
  return {
    agentId: "codex_app",
    branchName: null,
    codexDeepLink: `codex://threads/${thread.id}`,
    createdAt: secondsToIso(thread.createdAt),
    createdByUserId: userId,
    id: externalCodexConversationId(thread.id),
    projectId: externalCodexProjectId(thread.cwd),
    prompt: codexThreadTitle(thread),
    runtimeSessionId: thread.id,
    source: "codex_app",
    status: codexThreadToConversationStatus(thread),
    type: "investigation",
    updatedAt: secondsToIso(safeSeconds(thread.updatedAt, thread.createdAt)),
    workspaceId,
    worktreePath: thread.cwd
  };
}

function codexThreadToCompletionState(thread: CodexAppThread, workspaceId: string) {
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
    source: "codex_app" as const,
    status,
    updatedAt: secondsToIso(safeSeconds(thread.updatedAt, thread.createdAt)),
    workspaceId
  };
}

function flattenThreadMessages(
  thread: CodexAppThread,
  conversationId = externalCodexConversationId(thread.id)
): LocalCodexMessage[] {
  const messages: LocalCodexMessage[] = [];
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
        id: `${conversationId}_${encodeURIComponent(turn.id)}_${encodeURIComponent(codexItemId)}${
          occurrence > 1 ? `_${occurrence}` : ""
        }`,
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

function codexThreadToConversationStatus(thread: CodexAppThread): ConversationStatus {
  const latestTurn = thread.turns.at(-1) ?? null;

  if (latestTurn?.error) {
    return "failed";
  }

  if (latestTurn && isTurnInterrupted(latestTurn)) {
    return "cancelled";
  }

  if (threadStatusType(thread.status) === "active") {
    if (latestTurn && isTurnTerminal(latestTurn)) {
      return "approved";
    }

    if (hasActiveFlag(thread.status, "waitingOnApproval")) {
      return "awaiting_approval";
    }

    return "running";
  }

  return "approved";
}

function isCodexThreadBusy(thread: CodexAppThread) {
  if (threadStatusType(thread.status) !== "active") {
    return false;
  }

  const latestTurn = thread.turns.at(-1) ?? null;
  return !(latestTurn && isTurnTerminal(latestTurn));
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

function threadItemToMessageContent(
  item: CodexAppThreadItem
): { role: LocalCodexMessage["role"]; content: string } | null {
  if (item.type === "userMessage") {
    const userMessage = item as { content?: CodexAppUserInput[] };
    const content = safeString(
      Array.isArray(userMessage.content)
        ? userMessage.content.map(userInputToText).filter(Boolean).join("\n")
        : ""
    ).trim();
    return content ? { content: truncateMessageContent(content), role: "user" } : null;
  }

  if (item.type === "agentMessage" || item.type === "plan") {
    const textItem = item as { text?: string };
    const content = safeString(textItem.text).trim();
    return content ? { content: truncateMessageContent(content), role: "assistant" } : null;
  }

  if (item.type === "commandExecution") {
    const commandItem = item as { aggregatedOutput?: string | null; command?: string };
    const output = safeString(commandItem.aggregatedOutput ?? commandItem.command).trim();
    return output
      ? { content: truncateMessageContent(output, "Command output"), role: "runtime" }
      : null;
  }

  if (item.type === "fileChange") {
    const fileChange = item as { changes?: unknown[] };
    const count = Array.isArray(fileChange.changes) ? fileChange.changes.length : 0;
    return {
      content: `Updated ${count} file${count === 1 ? "" : "s"}.`,
      role: "runtime"
    };
  }

  return null;
}

function userInput(
  prompt: string,
  attachments: LocalAttachmentReference[] = []
): CodexAppUserInput[] {
  return [
    { text: normalizedPrompt(prompt), text_elements: [], type: "text" },
    ...attachments.map((attachment): CodexAppUserInput => {
      if (attachment.kind === "image") {
        return { path: attachment.path, type: "localImage" };
      }

      return { name: attachment.name, path: attachment.path, type: "mention" };
    })
  ];
}

function normalizedPrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Prompt is required"), { statusCode: 400 });
  }
  return trimmed;
}

function userInputToText(input: CodexAppUserInput) {
  switch (input.type) {
    case "text":
      return safeString(input.text);
    case "localImage":
      return `[Local image: ${input.path}]`;
    case "mention":
      return `[Mention: ${input.name}]`;
  }
}

function turnModelSettings(modelSettings: CodexMobileModelSettings | undefined) {
  return modelSettings ? { effort: modelSettings.effort, model: modelSettings.model } : {};
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

function uniqueReasoningEfforts(input: unknown): CodexReasoningEffort[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return [
    ...new Set(
      input.flatMap((item) => {
        if (typeof item === "string") {
          return reasoningEffort(item) ?? [];
        }

        if (!item || typeof item !== "object") {
          return [];
        }

        return reasoningEffort((item as { reasoningEffort?: unknown }).reasoningEffort) ?? [];
      })
    )
  ];
}

function reasoningEffort(input: unknown): CodexReasoningEffort | null {
  return input === "none" ||
    input === "minimal" ||
    input === "low" ||
    input === "medium" ||
    input === "high" ||
    input === "xhigh"
    ? input
    : null;
}

function isTurnInProgress(turn: CodexAppTurn) {
  return turnStatusType(turn) === "inProgress";
}

function isTurnInterrupted(turn: CodexAppTurn) {
  return turnStatusType(turn) === "interrupted";
}

function isTurnCompleted(turn: CodexAppTurn) {
  return turnStatusType(turn) === "completed";
}

function isTurnTerminal(turn: CodexAppTurn) {
  return isTurnCompleted(turn) || isTurnInterrupted(turn);
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

function threadStatusType(status: CodexAppThreadStatus) {
  if (typeof status === "string") {
    return status;
  }
  if (status && typeof status === "object") {
    return status.type;
  }
  return null;
}

function hasActiveFlag(status: CodexAppThreadStatus, flag: string) {
  return (
    status &&
    typeof status === "object" &&
    Array.isArray(status.activeFlags) &&
    status.activeFlags.includes(flag)
  );
}

function isTurnFinishedNotification(
  method: string,
  params: unknown,
  threadId: string,
  turnId: string
) {
  if (!params || typeof params !== "object") {
    return false;
  }

  const notification = params as {
    error?: unknown;
    status?: { type?: unknown };
    threadId?: unknown;
    turn?: { id?: unknown };
    turnId?: unknown;
  };

  if (notification.threadId !== threadId) {
    return false;
  }

  if (method === "turn/completed") {
    return notification.turn?.id === turnId || notification.turnId === turnId;
  }

  if (method === "error") {
    return notification.turnId === turnId;
  }

  return method === "thread/status/changed" && notification.status?.type === "idle";
}

function projectNameFromCwd(cwd: string) {
  return basename(normalize(cwd)) || cwd;
}

function codexThreadTitle(thread: CodexAppThread) {
  return thread.name?.trim() || thread.preview.trim() || "Untitled Codex thread";
}

function itemCreatedAt(thread: CodexAppThread, turn: CodexAppTurn, sequence: number) {
  const seconds = safeSeconds(
    turn.startedAt,
    turn.completedAt,
    thread.updatedAt,
    thread.createdAt,
    Date.now() / 1000
  );
  return new Date(seconds * 1000 + sequence).toISOString();
}

function secondsToIso(seconds: number) {
  return new Date(safeSeconds(seconds) * 1000).toISOString();
}

function safeSeconds(...candidates: Array<number | null | undefined>) {
  return candidates.find((candidate): candidate is number => Number.isFinite(candidate)) ?? 0;
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringValue(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

function truncateMessageContent(content: string, label = "Message") {
  if (content.length <= MAX_CODEX_MESSAGE_CONTENT_LENGTH) {
    return content;
  }

  return `${content.slice(0, MAX_CODEX_MESSAGE_CONTENT_LENGTH)}\n\n[${label} output truncated from ${content.length.toLocaleString()} characters for iPhone stability.]`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
