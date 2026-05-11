import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize } from "node:path";
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
  LocalCodexProjectSummary,
  LocalGeneratedFileSummary
} from "./server.js";
import {
  attachmentDiagnostics,
  errorDiagnostics,
  logDiagnostics,
  promptDiagnostics,
  type MobileControlDiagnosticsLogger
} from "./diagnostics-log.js";

const CODEX_PROJECT_PREFIX = "codex_project_";
const CODEX_THREAD_PREFIX = "codex_thread_";
const DEFAULT_SERVER_URL = "ws://127.0.0.1:47777";
const DEFAULT_CODEX_BINARY = "/Applications/Codex.app/Contents/Resources/codex";
const REQUEST_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 15_000;
const TURN_KEEPALIVE_TIMEOUT_MS = 30 * 60_000;
const QUEUED_TURN_POLL_INTERVAL_MS = 250;
const THREAD_LIST_CACHE_TTL_MS = 2_500;
const MAX_CODEX_MESSAGE_CONTENT_LENGTH = 12_000;
const HIDDEN_CODEX_ITEM_TYPES = new Set(["reasoning"]);
const PHONE_FULL_ACCESS_TURN_OPTIONS = {
  approvalPolicy: "never",
  sandboxPolicy: { type: "dangerFullAccess" }
} satisfies Pick<CodexAppStartTurnOptions, "approvalPolicy" | "sandboxPolicy">;

let spawnedAppServer: ChildProcess | null = null;
let nextRequestId = 1;
const activeTurnKeepAlives = new Set<Promise<void>>();

interface CreateLocalCodexBridgeOptions {
  diagnostics?: MobileControlDiagnosticsLogger;
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
  abitatLoadedFromAppServer?: boolean;
  abitatThreadListActivityAt?: number;
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

interface CodexAppLoadedThreadListResponse {
  data: string[];
  nextCursor: string | null;
}

interface QueuedCodexTurnInput {
  attachments?: LocalAttachmentReference[];
  modelSettings?: CodexMobileModelSettings;
  prompt: string;
}

interface MessageHistoryCacheEntry {
  messages: LocalCodexMessage[];
  statusType: string | null | undefined;
  updatedAt: number;
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
  const diagnostics = options.diagnostics;
  const workspaceId = options.workspaceId ?? "local";
  const userId = options.userId ?? "local";
  const queuedTurnsByThread = new Map<string, QueuedCodexTurnInput[]>();
  const queueDrainTimers = new Map<string, NodeJS.Timeout>();
  const threadListCache = new Map<
    string,
    { expiresAt: number; promise: Promise<CodexAppThread[]> }
  >();
  const messageHistoryCache = new Map<string, MessageHistoryCacheEntry>();

  async function listAllThreads(params: CodexAppThreadListParams = {}) {
    const cacheKey = threadListCacheKey(params);
    const cached = threadListCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.promise;
    }

    const promise = loadAllThreads(params).catch((error) => {
      threadListCache.delete(cacheKey);
      throw error;
    });
    threadListCache.set(cacheKey, {
      expiresAt: now + THREAD_LIST_CACHE_TTL_MS,
      promise
    });
    return promise;
  }

  async function loadAllThreads(params: CodexAppThreadListParams = {}) {
    if (params.useStateDbOnly !== undefined) {
      return listAllThreadsOnce(params);
    }

    const stateThreads = await listAllThreadsOnce({ ...params, useStateDbOnly: true });
    const liveThreads = await listAllThreadsOnce({ ...params, useStateDbOnly: false }).catch(
      () => []
    );
    const loadedThreads = await listLoadedThreads(params).catch(() => []);

    return mergeCodexThreadLists(stateThreads, liveThreads, loadedThreads);
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

  async function listLoadedThreads(params: CodexAppThreadListParams) {
    const loadedThreadIds = await client.listLoadedThreads();
    const threads: Array<CodexAppThread | null> = await Promise.all(
      loadedThreadIds.map(async (threadId): Promise<CodexAppThread | null> => {
        const thread = await client.readThread(threadId, false).catch(() => null);
        return thread ? { ...thread, abitatLoadedFromAppServer: true } : null;
      })
    );

    return threads.filter((thread): thread is CodexAppThread =>
      Boolean(thread && !thread.ephemeral && thread.cwd && threadMatchesListParams(thread, params))
    );
  }

  async function resolveProjectCwd(projectId: string) {
    for (const thread of await listAllThreads()) {
      if (externalCodexProjectId(thread.cwd) === projectId) {
        return thread.cwd;
      }
    }

    throw Object.assign(new Error("Codex project not found"), { statusCode: 404 });
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

  function enqueueTurn(threadId: string, input: QueuedCodexTurnInput, options = { front: false }) {
    invalidateMessageHistoryCache(threadId);
    const existing = queuedTurnsByThread.get(threadId) ?? [];
    const next = options.front ? [input, ...existing] : [...existing, input];
    queuedTurnsByThread.set(threadId, next);
    scheduleQueueDrain(threadId);
  }

  function invalidateMessageHistoryCache(threadId: string) {
    messageHistoryCache.delete(threadId);
  }

  function scheduleQueueDrain(threadId: string, delayMs = QUEUED_TURN_POLL_INTERVAL_MS) {
    if (queueDrainTimers.has(threadId)) {
      return;
    }

    const timer = setTimeout(() => {
      queueDrainTimers.delete(threadId);
      void drainQueuedTurns(threadId);
    }, delayMs);
    timer.unref?.();
    queueDrainTimers.set(threadId, timer);
  }

  async function drainQueuedTurns(threadId: string) {
    const queue = queuedTurnsByThread.get(threadId);
    if (!queue?.length) {
      queuedTurnsByThread.delete(threadId);
      return;
    }

    let thread: CodexAppThread;
    try {
      thread = await client.readThread(threadId, true);
    } catch {
      scheduleQueueDrain(threadId);
      return;
    }

    if (isCodexThreadBusy(thread)) {
      scheduleQueueDrain(threadId);
      return;
    }

    const nextInput = queue.shift();
    if (!nextInput) {
      queuedTurnsByThread.delete(threadId);
      return;
    }

    if (queue.length === 0) {
      queuedTurnsByThread.delete(threadId);
    }

    await startConversationTurn(threadId, thread, nextInput);

    if ((queuedTurnsByThread.get(threadId)?.length ?? 0) > 0) {
      scheduleQueueDrain(threadId);
    }
  }

  async function startConversationTurn(
    threadId: string,
    thread: CodexAppThread,
    input: QueuedCodexTurnInput
  ) {
    invalidateMessageHistoryCache(threadId);
    let activeThread = thread;
    if (threadStatusType(activeThread.status) !== "active") {
      activeThread = (await client.resumeThread({ excludeTurns: false, threadId })).thread;
    }

    await client.startTurn(threadId, userInput(input.prompt, input.attachments), {
      ...PHONE_FULL_ACCESS_TURN_OPTIONS,
      cwd: activeThread.cwd,
      ...turnModelSettings(input.modelSettings)
    });
  }

  return {
    async bootstrap() {
      try {
        await client.listThreads({ limit: 1, useStateDbOnly: true });
        logDiagnostics(diagnostics, "info", "codex.app_server.bootstrap", {
          available: true
        });
        return { available: true };
      } catch (error) {
        logDiagnostics(diagnostics, "error", "codex.app_server.bootstrap_failure", {
          available: false,
          error: errorDiagnostics(error)
        });
        return { available: false, error: errorMessage(error) };
      }
    },

    async continueConversation(conversationId, input) {
      const threadId = toCodexThreadId(conversationId);
      const thread = await client.readThread(threadId, true);
      const delivery = input.delivery ?? "queue";

      if (isCodexThreadBusy(thread)) {
        if (delivery === "steer") {
          const activeTurn = latestActiveTurn(thread);
          if (!activeTurn) {
            throw Object.assign(new Error("No active Codex turn is available to steer"), {
              statusCode: 409
            });
          }

          invalidateMessageHistoryCache(threadId);
          await client.steerTurn(
            threadId,
            userInput(input.prompt, input.attachments),
            activeTurn.id
          );
          return {
            conversationId: externalCodexConversationId(threadId),
            status: "running"
          };
        }

        enqueueTurn(threadId, input);
        return {
          conversationId: externalCodexConversationId(threadId),
          status: "queued"
        };
      }

      if ((queuedTurnsByThread.get(threadId)?.length ?? 0) > 0) {
        enqueueTurn(threadId, input, { front: delivery === "steer" });
        return {
          conversationId: externalCodexConversationId(threadId),
          status: "queued"
        };
      }

      await startConversationTurn(threadId, thread, input);

      return {
        conversationId: externalCodexConversationId(threadId),
        status: "running"
      };
    },

    async listCompletionStates() {
      const threads = await readThreadsWithTurns(await loadAllThreads());
      const states = threads.map((thread) => codexThreadToCompletionState(thread, workspaceId));
      logDiagnostics(diagnostics, "info", "completion.states.result", {
        activeCount: states.filter((state) => isActiveMobileConversationStatus(state.status))
          .length,
        stateCount: states.length
      });
      return states.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    },

    async listMessages(conversationId, messageOptions = {}) {
      const threadId = toCodexThreadId(conversationId);
      const messages = await readCachedThreadMessages(threadId, messageOptions.afterSequence);
      const returned = filterThreadMessages(messages, messageOptions);

      logDiagnostics(diagnostics, "info", "messages.list.bridge_result", {
        ...messageCounts(messages),
        afterSequence: messageOptions.afterSequence,
        conversationId: externalCodexConversationId(threadId),
        includeRuntime: messageOptions.includeRuntime === true,
        returned: returned.length,
        total: messages.length
      });

      return returned;
    },

    async listGeneratedFiles(conversationId) {
      return generatedFilesForThread(
        await client.readThread(toCodexThreadId(conversationId), true)
      );
    },

    async downloadGeneratedFile(conversationId, fileId) {
      const files = await generatedFilesForThread(
        await client.readThread(toCodexThreadId(conversationId), true)
      );
      const file = files.find((candidate) => candidate.id === fileId);
      if (!file) {
        throw Object.assign(new Error("Generated file not found"), { statusCode: 404 });
      }

      const data = await readFile(file.path);
      return {
        ...file,
        dataBase64: data.toString("base64")
      };
    },

    listModelOptions() {
      return client.listModels();
    },

    async listProjectConversations(projectId) {
      const cwd = await resolveProjectCwd(projectId);
      const threads = await hydrateConversationStatusThreads(await listAllThreads({ cwd }));
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
      invalidateMessageHistoryCache(thread.id);
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
      threads.map(async (thread) => {
        const readThread = await client.readThread(thread.id, true).catch(() => thread);
        return mergeCodexThreadSnapshots(readThread, thread);
      })
    );
  }

  async function hydrateConversationStatusThreads(threads: CodexAppThread[]) {
    return Promise.all(
      threads.map(async (thread) => {
        if (!needsConversationStatusHydration(thread)) {
          return thread;
        }

        const readThread = await client.readThread(thread.id, true).catch(() => thread);
        return mergeCodexThreadSnapshots(readThread, thread);
      })
    );
  }

  async function readCachedThreadMessages(threadId: string, afterSequence: number | undefined) {
    const cached = messageHistoryCache.get(threadId);
    if (typeof afterSequence === "number" && cached) {
      const summary = await client.readThread(threadId, false).catch(() => null);
      if (summary && canUseCachedMessageHistory(cached, summary)) {
        return cached.messages;
      }
    }

    const thread = await client.readThread(threadId, true);
    const messages = flattenThreadMessages(
      thread,
      externalCodexConversationId(threadId),
      diagnostics
    );
    if (isCodexThreadMessageHistoryStable(thread)) {
      messageHistoryCache.set(threadId, {
        messages,
        statusType: threadStatusType(thread.status),
        updatedAt: safeSeconds(thread.updatedAt, thread.createdAt)
      });
    } else {
      invalidateMessageHistoryCache(threadId);
    }

    return messages;
  }

  function canUseCachedMessageHistory(cached: MessageHistoryCacheEntry, summary: CodexAppThread) {
    return (
      !isCodexThreadBusy(summary) &&
      cached.statusType === threadStatusType(summary.status) &&
      cached.updatedAt === safeSeconds(summary.updatedAt, summary.createdAt)
    );
  }
}

function createCodexAppClient(options: CreateLocalCodexBridgeOptions) {
  const serverUrl = options.serverUrl ?? process.env.CODEX_APP_SERVER_URL ?? DEFAULT_SERVER_URL;
  const codexBinaryPath =
    options.codexBinaryPath ?? process.env.CODEX_APP_BINARY ?? DEFAULT_CODEX_BINARY;
  const diagnostics = options.diagnostics;

  return {
    listModels: async () => {
      const models: CodexModelOption[] = [];
      let cursor: string | null = null;

      do {
        const response: { data: Array<Record<string, unknown>>; nextCursor: string | null } =
          await callCodexApp(
            serverUrl,
            codexBinaryPath,
            "model/list",
            {
              cursor,
              includeHidden: false,
              limit: 200
            },
            diagnostics
          );
        models.push(...response.data.flatMap(normalizeCodexModel));
        cursor = response.nextCursor;
      } while (cursor);

      return models;
    },

    async listLoadedThreads(): Promise<string[]> {
      const threadIds: string[] = [];
      let cursor: string | null = null;

      do {
        const response: CodexAppLoadedThreadListResponse =
          await callCodexApp<CodexAppLoadedThreadListResponse>(
            serverUrl,
            codexBinaryPath,
            "thread/loaded/list",
            {
              cursor,
              limit: 200
            },
            diagnostics
          );
        threadIds.push(...response.data);
        cursor = response.nextCursor;
      } while (cursor);

      return threadIds;
    },

    listThreads: (params: CodexAppThreadListParams = {}) =>
      callCodexApp<CodexAppThreadListResponse>(
        serverUrl,
        codexBinaryPath,
        "thread/list",
        {
          archived: false,
          limit: 200,
          sortDirection: "desc",
          useStateDbOnly: true,
          ...params
        },
        diagnostics
      ),

    async readThread(threadId: string, includeTurns = true) {
      logDiagnostics(diagnostics, "info", "codex.thread_read.call", {
        includeTurns,
        threadId
      });
      try {
        const response = await callCodexApp<{ thread: CodexAppThread }>(
          serverUrl,
          codexBinaryPath,
          "thread/read",
          { includeTurns, threadId },
          diagnostics
        );
        logDiagnostics(diagnostics, "info", "codex.thread_read.result", {
          includeTurns,
          threadId,
          turnCount: response.thread.turns.length
        });
        return response.thread;
      } catch (error) {
        logDiagnostics(diagnostics, "error", "codex.thread_read.failure", {
          error: errorDiagnostics(error),
          includeTurns,
          threadId
        });
        throw error;
      }
    },

    resumeThread: (params: { excludeTurns?: boolean; threadId: string }) =>
      callCodexApp<{ thread: CodexAppThread }>(
        serverUrl,
        codexBinaryPath,
        "thread/resume",
        params,
        diagnostics
      ),

    startThread: (params: {
      cwd?: string | null;
      experimentalRawEvents?: boolean;
      persistExtendedHistory?: boolean;
    }) =>
      callCodexApp<{ thread: CodexAppThread }>(
        serverUrl,
        codexBinaryPath,
        "thread/start",
        {
          experimentalRawEvents: false,
          persistExtendedHistory: true,
          ...params
        },
        diagnostics
      ),

    startTurn: (
      threadId: string,
      input: CodexAppUserInput[],
      turnOptions: CodexAppStartTurnOptions
    ) =>
      startTurnWithKeepAlive(serverUrl, codexBinaryPath, threadId, input, turnOptions, diagnostics),

    steerTurn: (threadId: string, input: CodexAppUserInput[], expectedTurnId: string) =>
      steerTurnWithKeepAlive(
        serverUrl,
        codexBinaryPath,
        threadId,
        input,
        expectedTurnId,
        diagnostics
      )
  };
}

async function callCodexApp<TResult>(
  serverUrl: string,
  codexBinaryPath: string,
  method: string,
  params: unknown,
  diagnostics?: MobileControlDiagnosticsLogger
): Promise<TResult> {
  try {
    return await callCodexAppOnce<TResult>(serverUrl, method, params);
  } catch (error) {
    if (!isConnectionFailure(error) || !canStartLocalServer(serverUrl)) {
      throw error;
    }

    logDiagnostics(diagnostics, "warn", "codex.app_server.connect_failure", {
      error: errorDiagnostics(error),
      method,
      serverUrl
    });
    await ensureLocalAppServer(serverUrl, codexBinaryPath, diagnostics);
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
  options: CodexAppStartTurnOptions,
  diagnostics?: MobileControlDiagnosticsLogger
) {
  logDiagnostics(diagnostics, "info", "codex.turn_start.call", {
    ...turnInputDiagnostics(input),
    cwd: options.cwd,
    effort: options.effort,
    model: options.model,
    threadId
  });
  try {
    const response = await startTurnWithKeepAliveOnce(serverUrl, threadId, input, options);
    logDiagnostics(diagnostics, "info", "codex.turn_start.result", {
      status: turnStatusType(response.turn),
      threadId,
      turnId: response.turn.id
    });
    return response;
  } catch (error) {
    if (!isConnectionFailure(error) || !canStartLocalServer(serverUrl)) {
      logDiagnostics(diagnostics, "error", "codex.turn_start.failure", {
        error: errorDiagnostics(error),
        threadId
      });
      throw error;
    }

    logDiagnostics(diagnostics, "warn", "codex.app_server.connect_failure", {
      error: errorDiagnostics(error),
      method: "turn/start",
      serverUrl
    });
    await ensureLocalAppServer(serverUrl, codexBinaryPath, diagnostics);
    try {
      const response = await startTurnWithKeepAliveOnce(serverUrl, threadId, input, options);
      logDiagnostics(diagnostics, "info", "codex.turn_start.result", {
        status: turnStatusType(response.turn),
        threadId,
        turnId: response.turn.id
      });
      return response;
    } catch (retryError) {
      logDiagnostics(diagnostics, "error", "codex.turn_start.failure", {
        error: errorDiagnostics(retryError),
        threadId
      });
      throw retryError;
    }
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

async function steerTurnWithKeepAlive(
  serverUrl: string,
  codexBinaryPath: string,
  threadId: string,
  input: CodexAppUserInput[],
  expectedTurnId: string,
  diagnostics?: MobileControlDiagnosticsLogger
) {
  logDiagnostics(diagnostics, "info", "codex.turn_steer.call", {
    ...turnInputDiagnostics(input),
    expectedTurnId,
    threadId
  });
  try {
    const response = await steerTurnWithKeepAliveOnce(serverUrl, threadId, input, expectedTurnId);
    logDiagnostics(diagnostics, "info", "codex.turn_steer.result", {
      expectedTurnId,
      threadId,
      turnId: response.turnId
    });
    return response;
  } catch (error) {
    if (!isConnectionFailure(error) || !canStartLocalServer(serverUrl)) {
      logDiagnostics(diagnostics, "error", "codex.turn_steer.failure", {
        error: errorDiagnostics(error),
        expectedTurnId,
        threadId
      });
      throw error;
    }

    logDiagnostics(diagnostics, "warn", "codex.app_server.connect_failure", {
      error: errorDiagnostics(error),
      method: "turn/steer",
      serverUrl
    });
    await ensureLocalAppServer(serverUrl, codexBinaryPath, diagnostics);
    try {
      const response = await steerTurnWithKeepAliveOnce(serverUrl, threadId, input, expectedTurnId);
      logDiagnostics(diagnostics, "info", "codex.turn_steer.result", {
        expectedTurnId,
        threadId,
        turnId: response.turnId
      });
      return response;
    } catch (retryError) {
      logDiagnostics(diagnostics, "error", "codex.turn_steer.failure", {
        error: errorDiagnostics(retryError),
        expectedTurnId,
        threadId
      });
      throw retryError;
    }
  }
}

async function steerTurnWithKeepAliveOnce(
  serverUrl: string,
  threadId: string,
  input: CodexAppUserInput[],
  expectedTurnId: string
) {
  const connection = await JsonRpcConnection.connect(serverUrl);
  let keepAliveStarted = false;

  try {
    await initializeConnection(connection);
    const response = await connection.call<{ turnId: string }>("turn/steer", {
      expectedTurnId,
      input,
      threadId
    });

    keepAliveStarted = true;
    keepTurnConnectionAlive(connection, threadId, response.turnId);

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

async function ensureLocalAppServer(
  serverUrl: string,
  codexBinaryPath: string,
  diagnostics?: MobileControlDiagnosticsLogger
) {
  if (!spawnedAppServer || spawnedAppServer.exitCode !== null || spawnedAppServer.killed) {
    logDiagnostics(diagnostics, "info", "codex.app_server.bootstrap_start", {
      codexBinaryPath,
      serverUrl
    });
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
      logDiagnostics(diagnostics, "info", "codex.app_server.bootstrap_connected", {
        elapsedMs: Date.now() - startedAt,
        serverUrl
      });
      return;
    }
    await delay(250);
  }

  logDiagnostics(diagnostics, "error", "codex.app_server.bootstrap_failure", {
    elapsedMs: Date.now() - startedAt,
    serverUrl
  });
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

function threadListCacheKey(params: CodexAppThreadListParams) {
  return JSON.stringify({
    archived: params.archived ?? null,
    cursor: params.cursor ?? null,
    cwd: params.cwd ?? null,
    limit: params.limit ?? null,
    sortDirection: params.sortDirection ?? null,
    useStateDbOnly: params.useStateDbOnly ?? null
  });
}

function mergeCodexThreadLists(...threadLists: CodexAppThread[][]) {
  const byId = new Map<string, CodexAppThread>();

  for (const thread of threadLists.flat()) {
    byId.set(thread.id, mergeCodexThreadSnapshots(byId.get(thread.id), thread));
  }

  return Array.from(byId.values()).sort(
    (left, right) =>
      safeSeconds(right.updatedAt, right.createdAt) - safeSeconds(left.updatedAt, left.createdAt)
  );
}

function mergeCodexThreadSnapshots(
  baseThread: CodexAppThread | null | undefined,
  nextThread: CodexAppThread
) {
  if (!baseThread) {
    return nextThread;
  }

  const abitatLoadedFromAppServer =
    baseThread.abitatLoadedFromAppServer || nextThread.abitatLoadedFromAppServer || undefined;
  const abitatThreadListActivityAt = maxOptionalSeconds(
    threadListActivitySeconds(baseThread),
    threadListActivitySeconds(nextThread)
  );

  return {
    ...baseThread,
    ...nextThread,
    abitatLoadedFromAppServer,
    abitatThreadListActivityAt: abitatThreadListActivityAt ?? undefined,
    createdAt: safeSeconds(baseThread.createdAt, nextThread.createdAt),
    status: hasUnpersistedThreadListActivity(baseThread, nextThread, {
      threadListActivityAt: abitatThreadListActivityAt
    })
      ? { activeFlags: [], type: "active" }
      : preferredMergedThreadStatus(baseThread, nextThread),
    turns: nextThread.turns.length > 0 ? nextThread.turns : baseThread.turns,
    updatedAt: Math.max(
      safeSeconds(baseThread.updatedAt, baseThread.createdAt),
      safeSeconds(nextThread.updatedAt, nextThread.createdAt)
    )
  };
}

function preferredThreadStatus(baseStatus: CodexAppThreadStatus, nextStatus: CodexAppThreadStatus) {
  if (threadStatusType(baseStatus) === "active" && threadStatusType(nextStatus) === "active") {
    return { activeFlags: uniqueActiveFlags(baseStatus, nextStatus), type: "active" };
  }

  return threadStatusRank(nextStatus) > threadStatusRank(baseStatus) ? nextStatus : baseStatus;
}

function preferredMergedThreadStatus(baseThread: CodexAppThread, nextThread: CodexAppThread) {
  const baseLatestTurn = baseThread.turns.at(-1) ?? null;
  const nextIsActiveSummary =
    threadStatusType(nextThread.status) === "active" && nextThread.turns.length === 0;
  if (nextIsActiveSummary && baseLatestTurn && isTurnTerminal(baseLatestTurn)) {
    return baseThread.status;
  }

  return preferredThreadStatus(baseThread.status, nextThread.status);
}

function threadStatusRank(status: CodexAppThreadStatus) {
  switch (threadStatusType(status)) {
    case "active":
      return 4;
    case "systemError":
      return 3;
    case "idle":
      return 2;
    case "notLoaded":
      return 0;
    default:
      return 1;
  }
}

function threadMatchesListParams(thread: CodexAppThread, params: CodexAppThreadListParams) {
  if (!params.cwd) {
    return true;
  }

  const cwds = Array.isArray(params.cwd) ? params.cwd : [params.cwd];
  return cwds.includes(thread.cwd);
}

function uniqueActiveFlags(...statuses: CodexAppThreadStatus[]) {
  return [...new Set(statuses.flatMap((status) => activeFlags(status)))];
}

function activeFlags(status: CodexAppThreadStatus) {
  return status && typeof status === "object" && Array.isArray(status.activeFlags)
    ? status.activeFlags.filter((flag): flag is string => typeof flag === "string")
    : [];
}

function hasUnpersistedThreadListActivity(
  persistedThread: CodexAppThread,
  listedThread: CodexAppThread,
  input: { threadListActivityAt: number | null }
) {
  if (input.threadListActivityAt === null) {
    return false;
  }

  const latestTurn = threadWithTurns(persistedThread, listedThread)?.turns.at(-1) ?? null;
  if (!latestTurn) {
    return false;
  }

  return (
    isTurnInterrupted(latestTurn) &&
    latestTurn.completedAt === null &&
    input.threadListActivityAt >= safeSeconds(latestTurn.startedAt)
  );
}

function isThreadListActivitySummaryStatus(status: CodexAppThreadStatus) {
  const statusType = threadStatusType(status);
  return statusType === "idle" || statusType === "notLoaded";
}

function needsConversationStatusHydration(thread: CodexAppThread) {
  return (
    thread.turns.length === 0 &&
    (isThreadListActivitySummaryStatus(thread.status) ||
      threadStatusType(thread.status) === "active")
  );
}

function threadListActivitySeconds(thread: CodexAppThread) {
  const currentActivity =
    thread.turns.length === 0 &&
    (isThreadListActivitySummaryStatus(thread.status) ||
      threadStatusType(thread.status) === "active")
      ? safeSeconds(thread.updatedAt, thread.createdAt)
      : null;

  return maxOptionalSeconds(thread.abitatThreadListActivityAt ?? null, currentActivity);
}

function threadWithTurns(...threads: CodexAppThread[]) {
  return threads.find((thread) => thread.turns.length > 0) ?? null;
}

function maxOptionalSeconds(...values: Array<number | null | undefined>) {
  const seconds = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  return seconds.length > 0 ? Math.max(...seconds) : null;
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
  const activelyWorking = isActiveMobileConversationStatus(status);
  const failed =
    !activelyWorking &&
    (Boolean(latestTurn?.error) || Boolean(latestTurn && isTurnInterrupted(latestTurn)));
  const latestTurnCompletedAt = latestTurnCompletedAtIso(thread, latestTurn);
  const latestTurnFinished = Boolean(latestTurn && isTurnTerminal(latestTurn));

  return {
    conversationId: externalCodexConversationId(thread.id),
    failed,
    isComplete: Boolean(
      latestTurn?.id && (latestTurnCompletedAt || latestTurnFinished || failed) && !activelyWorking
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

export function flattenThreadMessages(
  thread: CodexAppThread,
  conversationId = externalCodexConversationId(thread.id),
  diagnostics?: MobileControlDiagnosticsLogger
): LocalCodexMessage[] {
  const messages: LocalCodexMessage[] = [];
  const itemOccurrences = new Map<string, number>();
  const itemTypeCounts = new Map<string, number>();
  const unknownItemTypes = new Set<string>();
  const assistantMessagesByTurn = new Map<string, number>();
  let sequence = 1;

  for (const turn of thread.turns) {
    for (const [itemIndex, item] of turn.items.entries()) {
      itemTypeCounts.set(item.type, (itemTypeCounts.get(item.type) ?? 0) + 1);
      const flattened = threadItemToMessageContent(item);
      if (!flattened) {
        if (!HIDDEN_CODEX_ITEM_TYPES.has(item.type) && !isKnownCodexItemType(item.type)) {
          unknownItemTypes.add(item.type);
          logDiagnostics(diagnostics, "warn", "codex.thread_item.unknown", {
            codexItemId: item.id,
            codexItemType: item.type,
            conversationId,
            threadId: thread.id,
            turnId: turn.id
          });
        }
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
      if (flattened.role === "assistant") {
        assistantMessagesByTurn.set(turn.id, (assistantMessagesByTurn.get(turn.id) ?? 0) + 1);
      }
      sequence += 1;
    }

    if (isTurnCompleted(turn) && (assistantMessagesByTurn.get(turn.id) ?? 0) === 0) {
      logDiagnostics(diagnostics, "warn", "codex.turn.completed_without_visible_assistant", {
        conversationId,
        itemTypeCounts: Object.fromEntries(itemTypeCounts.entries()),
        threadId: thread.id,
        turnId: turn.id,
        unknownItemTypes: [...unknownItemTypes]
      });
    }
  }

  logDiagnostics(diagnostics, "info", "codex.thread.messages_flattened", {
    ...messageCounts(messages),
    conversationId,
    itemTypeCounts: Object.fromEntries(itemTypeCounts.entries()),
    threadId: thread.id,
    total: messages.length,
    unknownItemTypes: [...unknownItemTypes]
  });

  return messages;
}

async function generatedFilesForThread(
  thread: CodexAppThread
): Promise<LocalGeneratedFileSummary[]> {
  const paths = new Set<string>();

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type !== "fileChange") {
        continue;
      }

      const fileChange = item as { changes?: unknown[] };
      for (const change of fileChange.changes ?? []) {
        const path = generatedFilePath(thread.cwd, change);
        if (path) {
          paths.add(path);
        }
      }
    }
  }

  const files = await Promise.all(
    Array.from(paths)
      .sort()
      .map(async (path): Promise<LocalGeneratedFileSummary | null> => {
        const stats = await stat(path).catch(() => null);
        if (!stats?.isFile()) {
          return null;
        }

        return {
          id: generatedFileId(thread.id, path),
          mimeType: mimeTypeForPath(path),
          name: basename(path),
          path,
          size: stats.size
        };
      })
  );

  return files.filter((file): file is LocalGeneratedFileSummary => Boolean(file));
}

function generatedFilePath(cwd: string, change: unknown) {
  if (!change || typeof change !== "object") {
    return null;
  }

  const candidate = change as Record<string, unknown>;
  const value =
    stringField(candidate, "path") ??
    stringField(candidate, "filePath") ??
    stringField(candidate, "absolutePath") ??
    stringField(candidate, "relativePath");
  if (!value) {
    return null;
  }

  return isAbsolute(value) ? normalize(value) : normalize(join(cwd, value));
}

function generatedFileId(threadId: string, path: string) {
  return `file_${createHash("sha256")
    .update(`${threadId}\0${normalize(path)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function stringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function mimeTypeForPath(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html";
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function codexThreadToConversationStatus(thread: CodexAppThread): ConversationStatus {
  const latestTurn = thread.turns.at(-1) ?? null;

  if (threadStatusType(thread.status) === "active") {
    if (hasActiveFlag(thread.status, "waitingOnApproval")) {
      return "awaiting_approval";
    }

    return "running";
  }

  if (latestTurn && isTurnInProgress(latestTurn)) {
    return "running";
  }

  if (latestTurn?.error) {
    return "failed";
  }

  if (latestTurn && isTurnInterrupted(latestTurn)) {
    return "cancelled";
  }

  return "approved";
}

function isCodexThreadBusy(thread: CodexAppThread) {
  return threadStatusType(thread.status) === "active";
}

function isCodexThreadMessageHistoryStable(thread: CodexAppThread) {
  return !isCodexThreadBusy(thread) && !thread.turns.some(isTurnInProgress);
}

function latestActiveTurn(thread: CodexAppThread) {
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index];
    if (turn && isTurnInProgress(turn)) {
      return turn;
    }
  }

  return null;
}

function isActiveMobileConversationStatus(status: ConversationStatus) {
  return status === "running" || status === "awaiting_approval";
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

function isKnownCodexItemType(type: string) {
  return (
    type === "userMessage" ||
    type === "agentMessage" ||
    type === "plan" ||
    type === "commandExecution" ||
    type === "fileChange" ||
    HIDDEN_CODEX_ITEM_TYPES.has(type)
  );
}

function filterThreadMessages(
  messages: LocalCodexMessage[],
  options: { afterSequence?: number; includeRuntime?: boolean }
) {
  const filtered = options.includeRuntime
    ? messages
    : messages.filter((message) => message.role !== "runtime");

  return typeof options.afterSequence === "number"
    ? filtered.filter((message) => message.sequence > options.afterSequence!)
    : filtered;
}

function messageCounts(messages: LocalCodexMessage[]) {
  const counts = {
    assistant: 0,
    runtime: 0,
    user: 0,
    visible: 0
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      counts.assistant += 1;
      counts.visible += 1;
    } else if (message.role === "user") {
      counts.user += 1;
      counts.visible += 1;
    } else if (message.role === "runtime") {
      counts.runtime += 1;
    }
  }

  return counts;
}

function turnInputDiagnostics(input: CodexAppUserInput[]) {
  const text = input.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
  const attachments = input.filter((item) => item.type !== "text");

  return {
    ...promptDiagnostics(text),
    ...attachmentDiagnostics(attachments)
  };
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
