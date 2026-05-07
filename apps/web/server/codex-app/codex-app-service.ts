import { createHash } from "node:crypto";
import { basename, normalize } from "node:path";

import type { ConversationStatus, ConversationType } from "@abitat/shared";

import { createCodexAppClient } from "./codex-app-client";

const CODEX_PROJECT_PREFIX = "codex_project_";
const CODEX_THREAD_PREFIX = "codex_thread_";
const DEFAULT_WORKSPACE_ID = "workspace_demo";
const DEFAULT_USER_ID = "user_demo";
const MAX_CODEX_MESSAGE_CONTENT_LENGTH = 12_000;
const PHONE_FULL_ACCESS_TURN_OPTIONS = {
  approvalPolicy: "never",
  sandboxPolicy: { type: "dangerFullAccess" }
} satisfies Pick<CodexAppStartTurnOptions, "approvalPolicy" | "sandboxPolicy">;

export type CodexAppThreadStatus =
  | { type: "active"; activeFlags?: unknown[] }
  | { type: "idle" }
  | { type: "notLoaded" }
  | { type: "systemError" };

export type CodexAppSessionSource =
  | "cli"
  | "vscode"
  | "exec"
  | "appServer"
  | "unknown"
  | Record<string, unknown>;

export type CodexAppUserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export interface CodexAppAttachmentInput {
  kind: "file" | "image";
  name: string;
  path: string;
}

export type CodexAppThreadItem =
  | { type: "userMessage"; id: string; content: CodexAppUserInput[] }
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase: unknown | null;
      memoryCitation: unknown | null;
    }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      processId: string | null;
      source: string;
      status: string;
      commandActions: unknown[];
      aggregatedOutput: string | null;
      exitCode: number | null;
      durationMs: number | null;
    }
  | { type: "fileChange"; id: string; changes: unknown[]; status: string };

export interface CodexAppTurn {
  id: string;
  items: CodexAppThreadItem[];
  status: unknown;
  error: unknown | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface CodexAppThread {
  id: string;
  forkedFromId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: CodexAppThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: CodexAppSessionSource;
  agentNickname?: string | null;
  agentRole?: string | null;
  gitInfo: unknown | null;
  name: string | null;
  turns: CodexAppTurn[];
}

export interface CodexAppThreadListParams {
  archived?: boolean | null;
  cursor?: string | null;
  cwd?: string | string[] | null;
  limit?: number | null;
  sortDirection?: "asc" | "desc" | null;
  sortKey?: string | null;
  useStateDbOnly?: boolean;
}

export interface CodexAppThreadListResponse {
  data: CodexAppThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface CodexAppStartTurnOptions {
  approvalPolicy?: "never";
  cwd?: string | null;
  sandboxPolicy?: { type: "dangerFullAccess" };
}

export interface CodexAppClient {
  listThreads(params?: CodexAppThreadListParams): Promise<CodexAppThreadListResponse>;
  readThread(threadId: string, includeTurns?: boolean): Promise<CodexAppThread>;
  resumeThread(params: {
    excludeTurns?: boolean;
    threadId: string;
  }): Promise<{ thread: CodexAppThread }>;
  startThread(params: {
    cwd?: string | null;
    experimentalRawEvents?: boolean;
    persistExtendedHistory?: boolean;
  }): Promise<{ thread: CodexAppThread }>;
  startTurn(
    threadId: string,
    input: CodexAppUserInput[],
    options?: CodexAppStartTurnOptions
  ): Promise<{ turn: CodexAppTurn }>;
}

export interface CodexAppProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  hostLocalPath: string;
  createdByUserId: string;
  repoSyncStatus: "codex_app";
  conversationCount: number;
  source: "codex_app";
  updatedAt: string;
}

export interface CodexAppConversationSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  agentId: "codex_app";
  createdByUserId: string;
  type: ConversationType;
  status: ConversationStatus;
  prompt: string;
  branchName: null;
  runtimeSessionId: string;
  worktreePath: string;
  source: "codex_app";
  codexDeepLink: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CodexAppMessage {
  id: string;
  conversationId: string;
  sequence: number;
  role: "user" | "assistant" | "runtime";
  sourceDeviceId: null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CodexCompletionState {
  conversationId: string;
  failed: boolean;
  isComplete: boolean;
  latestTurnCompletedAt: string | null;
  latestTurnId: string | null;
  projectId: string;
  prompt: string;
  source: "codex_app";
  status: ConversationStatus;
  updatedAt: string;
  workspaceId: string;
}

interface CodexAppServiceOptions {
  workspaceId?: string;
  userId?: string;
}

interface StartConversationInput {
  attachments?: CodexAppAttachmentInput[];
  prompt: string;
}

interface ListMessagesOptions {
  afterSequence?: number;
  includeRuntime?: boolean;
}

export function createCodexAppService(
  client: CodexAppClient,
  options: CodexAppServiceOptions = {}
) {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const userId = options.userId ?? DEFAULT_USER_ID;
  const messageCache = new Map<
    string,
    {
      messages: CodexAppMessage[];
      updatedAt: number;
    }
  >();

  async function listAllThreads(params: CodexAppThreadListParams = {}) {
    const threads: CodexAppThread[] = [];
    let cursor: string | null | undefined = params.cursor ?? null;

    do {
      const page = await client.listThreads({
        archived: false,
        limit: 200,
        sortDirection: "desc",
        useStateDbOnly: true,
        ...params,
        cursor
      });

      threads.push(...page.data.filter((thread) => !thread.ephemeral && thread.cwd));
      cursor = page.nextCursor;
    } while (cursor);

    return threads;
  }

  async function resolveProjectCwd(projectId: string) {
    if (!isCodexProjectId(projectId)) {
      throw new Error("Codex project not found");
    }

    const project = (await listProjects()).find((candidate) => candidate.id === projectId);

    if (!project) {
      throw new Error("Codex project not found");
    }

    return project.hostLocalPath;
  }

  async function listProjects(): Promise<CodexAppProjectSummary[]> {
    const grouped = new Map<string, { cwd: string; count: number; latestUpdatedAt: number }>();

    for (const thread of await listAllThreads()) {
      const current = grouped.get(thread.cwd);
      grouped.set(thread.cwd, {
        count: (current?.count ?? 0) + 1,
        cwd: thread.cwd,
        latestUpdatedAt: Math.max(current?.latestUpdatedAt ?? thread.updatedAt, thread.updatedAt)
      });
    }

    return [...grouped.values()]
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

  async function listProjectConversations(
    projectId: string
  ): Promise<CodexAppConversationSummary[]> {
    const cwd = await resolveProjectCwd(projectId);
    const threads = await listAllThreads({ cwd });

    return threads
      .filter((thread) => externalCodexProjectId(thread.cwd) === projectId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((thread) => codexThreadToConversation(thread, workspaceId, userId));
  }

  return {
    getProject: async (projectId: string) =>
      (await listProjects()).find((project) => project.id === projectId) ?? null,

    getConversation: async (conversationId: string) => {
      const thread = await client.readThread(toCodexThreadId(conversationId), true);
      return codexThreadToConversation(thread, workspaceId, userId);
    },

    listProjects,

    async listCompletionStates(): Promise<CodexCompletionState[]> {
      const threads = await readThreadsWithTurns(await listAllThreads());

      return threads
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((thread) => codexThreadToCompletionState(thread, workspaceId));
    },

    listProjectConversations,

    async listMessages(conversationId: string, options: ListMessagesOptions = {}) {
      const threadId = toCodexThreadId(conversationId);
      const messages = await cachedThreadMessages(threadId, externalCodexConversationId(threadId));
      const filteredMessages =
        options.includeRuntime === false
          ? messages.filter((message) => message.role !== "runtime")
          : messages;

      return typeof options.afterSequence === "number"
        ? filteredMessages.filter((message) => message.sequence > options.afterSequence!)
        : filteredMessages;
    },

    async startConversation(projectId: string, input: StartConversationInput) {
      const prompt = normalizedPrompt(input.prompt);
      const cwd = await resolveProjectCwd(projectId);
      const { thread } = await client.startThread({
        cwd,
        experimentalRawEvents: false,
        persistExtendedHistory: true
      });
      await client.startTurn(thread.id, userInput(prompt, input.attachments), {
        ...PHONE_FULL_ACCESS_TURN_OPTIONS,
        cwd
      });
      messageCache.delete(thread.id);

      return {
        conversationId: externalCodexConversationId(thread.id),
        status: "running" as ConversationStatus
      };
    },

    async continueConversation(conversationId: string, input: StartConversationInput) {
      const threadId = toCodexThreadId(conversationId);
      const prompt = normalizedPrompt(input.prompt);
      let resumed = false;
      const resumeThread = async () => {
        if (resumed) {
          return;
        }

        await client.resumeThread({ excludeTurns: true, threadId });
        resumed = true;
      };

      const thread = await client.readThread(threadId, false);
      if (thread.status.type === "systemError") {
        throw new Error(
          "Codex app thread is in a system error state. Open it on the Mac and resolve the error, or start a new Codex thread from the phone."
        );
      }

      if (thread.status.type === "notLoaded") {
        await resumeThread();
      }

      try {
        await client.startTurn(threadId, userInput(prompt, input.attachments), {
          ...PHONE_FULL_ACCESS_TURN_OPTIONS,
          cwd: thread.cwd
        });
      } catch (error) {
        if (!isThreadNotFoundError(error, threadId)) {
          throw error;
        }

        await resumeThread();
        await client.startTurn(threadId, userInput(prompt, input.attachments), {
          ...PHONE_FULL_ACCESS_TURN_OPTIONS,
          cwd: thread.cwd
        });
      }
      messageCache.delete(threadId);

      return {
        conversationId: externalCodexConversationId(threadId),
        status: "running" as ConversationStatus
      };
    }
  };

  async function readThreadsWithTurns(threads: CodexAppThread[]) {
    return Promise.all(
      threads.map(async (thread) => {
        try {
          return await client.readThread(thread.id, true);
        } catch {
          return thread;
        }
      })
    );
  }

  async function cachedThreadMessages(threadId: string, conversationId: string) {
    const cached = messageCache.get(threadId);

    if (cached) {
      const threadSummary = await client.readThread(threadId, false);
      if (threadSummary.updatedAt === cached.updatedAt) {
        return cached.messages;
      }
    }

    const thread = await client.readThread(threadId, true);
    const messages = flattenThreadMessages(thread, conversationId);
    messageCache.set(threadId, {
      messages,
      updatedAt: thread.updatedAt
    });
    return messages;
  }
}

export const codexAppService = createCodexAppService(createCodexAppClient());

export type CodexAppService = ReturnType<typeof createCodexAppService>;

export function externalCodexProjectId(cwd: string) {
  return `${CODEX_PROJECT_PREFIX}${createHash("sha256").update(normalize(cwd)).digest("hex").slice(0, 16)}`;
}

export function isCodexProjectId(projectId: string) {
  return projectId.startsWith(CODEX_PROJECT_PREFIX);
}

export function externalCodexConversationId(threadId: string) {
  return `${CODEX_THREAD_PREFIX}${encodeURIComponent(threadId)}`;
}

export function isCodexConversationId(conversationId: string) {
  return conversationId.startsWith(CODEX_THREAD_PREFIX);
}

export function toCodexThreadId(conversationId: string) {
  return isCodexConversationId(conversationId)
    ? decodeURIComponent(conversationId.slice(CODEX_THREAD_PREFIX.length))
    : conversationId;
}

export function codexAppDeepLink(threadId: string) {
  return `codex://local/${encodeURIComponent(threadId)}`;
}

export function codexThreadToConversation(
  thread: CodexAppThread,
  workspaceId = DEFAULT_WORKSPACE_ID,
  userId = DEFAULT_USER_ID
): CodexAppConversationSummary {
  return {
    agentId: "codex_app",
    branchName: null,
    codexDeepLink: codexAppDeepLink(thread.id),
    createdAt: secondsToDate(thread.createdAt),
    createdByUserId: userId,
    id: externalCodexConversationId(thread.id),
    projectId: externalCodexProjectId(thread.cwd),
    prompt: codexThreadTitle(thread),
    runtimeSessionId: thread.id,
    source: "codex_app",
    status: codexThreadToConversationStatus(thread),
    type: "investigation",
    updatedAt: secondsToDate(thread.updatedAt),
    workspaceId,
    worktreePath: thread.cwd
  };
}

export function flattenThreadMessages(
  thread: CodexAppThread,
  conversationId = externalCodexConversationId(thread.id)
): CodexAppMessage[] {
  const messages: CodexAppMessage[] = [];
  let sequence = 1;

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      const flattened = threadItemToMessageContent(item);

      if (!flattened) {
        continue;
      }

      messages.push({
        content: flattened.content,
        conversationId,
        createdAt: itemCreatedAt(thread, turn, sequence),
        id: `${conversationId}_${sequence}_${item.id ?? "item"}`,
        metadata: {
          codexItemId: item.id ?? null,
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

function codexThreadToCompletionState(
  thread: CodexAppThread,
  workspaceId = DEFAULT_WORKSPACE_ID
): CodexCompletionState {
  const latestTurn = thread.turns.at(-1) ?? null;
  const status = codexThreadToConversationStatus(thread);
  const failed =
    thread.status.type === "systemError" ||
    Boolean(latestTurn?.error) ||
    Boolean(latestTurn && isTurnInterrupted(latestTurn));
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
    prompt: codexThreadTitle(thread),
    source: "codex_app",
    status,
    updatedAt: secondsToIso(safeSeconds(thread.updatedAt, thread.createdAt)),
    workspaceId
  };
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

function isTurnCompleted(turn: CodexAppTurn) {
  return turnStatusType(turn) === "completed";
}

function isTurnInterrupted(turn: CodexAppTurn) {
  return turnStatusType(turn) === "interrupted";
}

function isTurnInProgress(turn: CodexAppTurn) {
  return turnStatusType(turn) === "inProgress";
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

function codexThreadToConversationStatus(thread: CodexAppThread): ConversationStatus {
  const latestTurn = thread.turns.at(-1) ?? null;

  if (thread.status.type === "systemError" || Boolean(latestTurn?.error)) {
    return "failed";
  }

  if (latestTurn && isTurnInterrupted(latestTurn)) {
    return "cancelled";
  }

  if (thread.status.type === "active") {
    if (latestTurn && isTurnTerminal(latestTurn)) {
      return "approved";
    }

    if (hasActiveFlag(thread.status, "waitingOnApproval")) {
      return "awaiting_approval";
    }

    if (latestTurn && isTurnInProgress(latestTurn)) {
      return "running";
    }

    return "running";
  }

  return "approved";
}

function hasActiveFlag(status: CodexAppThreadStatus, flag: string) {
  return (
    status.type === "active" &&
    Array.isArray(status.activeFlags) &&
    status.activeFlags.includes(flag)
  );
}

function codexThreadTitle(thread: CodexAppThread) {
  return thread.name?.trim() || thread.preview.trim() || "Untitled Codex thread";
}

function projectNameFromCwd(cwd: string) {
  return basename(normalize(cwd)) || cwd;
}

function threadItemToMessageContent(
  item: CodexAppThreadItem
): { role: CodexAppMessage["role"]; content: string } | null {
  if (item.type === "userMessage") {
    const content = safeString(
      Array.isArray(item.content)
        ? item.content.map(userInputToText).filter(Boolean).join("\n")
        : ""
    ).trim();
    return content ? { content: truncateMessageContent(content), role: "user" } : null;
  }

  if (item.type === "agentMessage") {
    const content = safeString(item.text).trim();
    return content ? { content: truncateMessageContent(content), role: "assistant" } : null;
  }

  if (item.type === "plan") {
    const content = safeString(item.text).trim();
    return content ? { content: truncateMessageContent(content), role: "assistant" } : null;
  }

  if (item.type === "commandExecution") {
    const output = safeString(item.aggregatedOutput ?? item.command).trim();
    const content = truncateMessageContent(output, "Command output");
    return content ? { content, role: "runtime" } : null;
  }

  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes.length : 0;
    return {
      content: `Updated ${changes} file${changes === 1 ? "" : "s"}.`,
      role: "runtime"
    };
  }

  return null;
}

function userInputToText(input: CodexAppUserInput) {
  switch (input.type) {
    case "text":
      return safeString(input.text);
    case "image":
      return `[Image: ${input.url}]`;
    case "localImage":
      return `[Local image: ${input.path}]`;
    case "skill":
      return `[Skill: ${input.name}]`;
    case "mention":
      return `[Mention: ${input.name}]`;
  }
}

function userInput(
  prompt: string,
  attachments: CodexAppAttachmentInput[] = []
): CodexAppUserInput[] {
  return [
    { text: prompt, text_elements: [], type: "text" },
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
    throw new Error("Prompt is required");
  }

  return trimmed;
}

function isThreadNotFoundError(error: unknown, threadId: string) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("thread not found") && message.includes(threadId.toLowerCase());
}

function secondsToDate(seconds: number) {
  return new Date(safeSeconds(seconds) * 1000);
}

function secondsToIso(seconds: number) {
  return secondsToDate(seconds).toISOString();
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

function safeSeconds(...candidates: Array<number | null | undefined>) {
  return candidates.find((candidate): candidate is number => Number.isFinite(candidate)) ?? 0;
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function truncateMessageContent(content: string, label = "Message") {
  if (content.length <= MAX_CODEX_MESSAGE_CONTENT_LENGTH) {
    return content;
  }

  return `${content.slice(0, MAX_CODEX_MESSAGE_CONTENT_LENGTH)}\n\n[${label} output truncated from ${content.length.toLocaleString()} characters for iPhone stability.]`;
}
