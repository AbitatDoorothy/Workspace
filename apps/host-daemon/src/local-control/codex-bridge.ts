import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize } from "node:path";
import { createInterface } from "node:readline";
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
const DEFAULT_SERVER_URL = "stdio://";
const DEFAULT_CODEX_BINARY = "/Applications/Codex.app/Contents/Resources/codex";
const REQUEST_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 15_000;
const TURN_KEEPALIVE_TIMEOUT_MS = 30 * 60_000;
const QUEUED_TURN_POLL_INTERVAL_MS = 250;
const THREAD_LIST_CACHE_TTL_MS = 2_500;
const LOCAL_STARTED_TURN_MATERIALIZATION_GRACE_MS = 5 * 60_000;
const MAX_CODEX_MESSAGE_CONTENT_LENGTH = 12_000;
const MAX_CONTEXT_SYNC_TURNS_WITHOUT_CURSOR = 6;
const HIDDEN_CODEX_ITEM_TYPES = new Set([
  "contextCompaction",
  "enteredReviewMode",
  "exitedReviewMode",
  "reasoning"
]);
const MAX_CODEX_ITEM_SUMMARY_LENGTH = 240;
const PHONE_FULL_ACCESS_TURN_OPTIONS = {
  approvalPolicy: "never",
  sandboxPolicy: { type: "dangerFullAccess" }
} satisfies Pick<CodexAppStartTurnOptions, "approvalPolicy" | "sandboxPolicy">;

let spawnedAppServer: ChildProcess | null = null;
let nextRequestId = 1;
const activeTurnKeepAlives = new Set<Promise<void>>();
const sharedStdioConnections = new Map<string, Promise<JsonRpcConnection>>();

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
  clientMessageId?: string;
  modelSettings?: CodexMobileModelSettings;
  prompt: string;
}

interface MessageHistoryCacheEntry {
  messages: LocalCodexMessage[];
  statusType: string | null | undefined;
  updatedAt: number;
}

interface ConversationStatusCacheEntry {
  summaryStatusType: string | null | undefined;
  summaryUpdatedAt: number;
  thread: CodexAppThread;
}

interface LocallyStartedTurn {
  startedAtMs: number;
  turnId: string;
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

interface JsonRpcTransport {
  close(): void;
  onClose(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
  onMessage(handler: (raw: string) => void): void;
  send(payload: string, callback: (error?: Error) => void): void;
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
  const conversationStatusCache = new Map<string, ConversationStatusCacheEntry>();
  const messageHistoryCache = new Map<string, MessageHistoryCacheEntry>();
  const modelContextSyncedTurnIds = new Map<string, string>();
  const locallyStartedTurnsByThread = new Map<string, LocallyStartedTurn>();

  function rememberLocallyStartedTurn(threadId: string, turnId: string | null | undefined) {
    if (!turnId) {
      return;
    }

    locallyStartedTurnsByThread.set(threadId, {
      startedAtMs: Date.now(),
      turnId
    });
  }

  function locallyStartedTurnForThread(thread: CodexAppThread) {
    const tracked = locallyStartedTurnsByThread.get(thread.id);
    if (!tracked) {
      return null;
    }

    const turn = thread.turns.find((candidate) => candidate.id === tracked.turnId);
    if (turn) {
      if (isTurnTerminal(turn)) {
        locallyStartedTurnsByThread.delete(thread.id);
        return null;
      }

      return tracked;
    }

    if (Date.now() - tracked.startedAtMs > LOCAL_STARTED_TURN_MATERIALIZATION_GRACE_MS) {
      locallyStartedTurnsByThread.delete(thread.id);
      return null;
    }

    return tracked;
  }

  async function listAllThreads(params: CodexAppThreadListParams = {}) {
    const cacheKey = threadListCacheKey(params);
    const cached = threadListCache.get(cacheKey);
    const now = Date.now();
    const canUseCache = locallyStartedTurnsByThread.size === 0;
    if (canUseCache && cached && cached.expiresAt > now) {
      return cached.promise;
    }

    const promise = loadAllThreads(params).catch((error) => {
      threadListCache.delete(cacheKey);
      throw error;
    });
    if (canUseCache) {
      threadListCache.set(cacheKey, {
        expiresAt: now + THREAD_LIST_CACHE_TTL_MS,
        promise
      });
    }
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
    const listedThreads = mergeCodexThreadLists(stateThreads, liveThreads);
    const listedThreadIds = new Set(listedThreads.map((thread) => thread.id));
    const loadedThreadIds = await client.listLoadedThreads().catch(() => []);
    const hasLoadedOnlyThreads = loadedThreadIds.some((threadId) => !listedThreadIds.has(threadId));
    const archivedThreadIds = hasLoadedOnlyThreads
      ? await listArchivedThreadIds(params).catch(() => new Set<string>())
      : new Set<string>();
    const loadedThreads = await listLoadedThreads(loadedThreadIds, params, {
      archivedThreadIds,
      listedThreadIds
    }).catch(() => []);

    return mergeCodexThreadLists(listedThreads, loadedThreads);
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

  async function listLoadedThreads(
    loadedThreadIds: string[],
    params: CodexAppThreadListParams,
    input: { archivedThreadIds: Set<string>; listedThreadIds: Set<string> }
  ) {
    const threads: Array<CodexAppThread | null> = await Promise.all(
      loadedThreadIds.map(async (threadId): Promise<CodexAppThread | null> => {
        const thread = await client.readThread(threadId, false).catch(() => null);
        const loadedThread = thread ? { ...thread, abitatLoadedFromAppServer: true } : null;
        return loadedThread ? loadedThreadForList(loadedThread, params, input) : null;
      })
    );

    return threads.filter((thread): thread is CodexAppThread => Boolean(thread));
  }

  async function loadedThreadForList(
    thread: CodexAppThread,
    params: CodexAppThreadListParams,
    input: { archivedThreadIds: Set<string>; listedThreadIds: Set<string> }
  ) {
    if (!thread || thread.ephemeral || !thread.cwd || !threadMatchesListParams(thread, params)) {
      return null;
    }

    if ((params.archived ?? false) !== false) {
      return thread;
    }

    if (input.archivedThreadIds.has(thread.id)) {
      return null;
    }

    if (input.listedThreadIds.has(thread.id)) {
      return thread;
    }

    if (!isCodexThreadBusy(thread)) {
      return null;
    }

    if (thread.turns.length === 0 && threadStatusType(thread.status) === "active") {
      const hydratedThread = await client.readThread(thread.id, true).catch(() => thread);
      const mergedThread = {
        ...mergeCodexThreadSnapshots(hydratedThread, thread),
        abitatLoadedFromAppServer: true
      };
      return isCodexThreadBusy(mergedThread) ? mergedThread : null;
    }

    return thread;
  }

  async function listArchivedThreadIds(params: CodexAppThreadListParams) {
    if ((params.archived ?? false) !== false) {
      return new Set<string>();
    }

    const archivedParams = {
      ...params,
      archived: true,
      cursor: null
    };
    const stateArchivedThreads = await listAllThreadsOnce({
      ...archivedParams,
      useStateDbOnly: true
    });
    const liveArchivedThreads = await listAllThreadsOnce({
      ...archivedParams,
      useStateDbOnly: false
    }).catch(() => []);

    return new Set(
      mergeCodexThreadLists(stateArchivedThreads, liveArchivedThreads).map((thread) => thread.id)
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
    const existingIndex = input.clientMessageId
      ? existing.findIndex((turn) => turn.clientMessageId === input.clientMessageId)
      : -1;
    if (existingIndex >= 0 && !options.front) {
      queuedTurnsByThread.set(
        threadId,
        existing.map((turn, turnIndex) => (turnIndex === existingIndex ? input : turn))
      );
      scheduleQueueDrain(threadId);
      return;
    }

    const withoutDuplicate =
      existingIndex >= 0
        ? existing.filter((_turn, turnIndex) => turnIndex !== existingIndex)
        : existing;
    const next = options.front ? [input, ...withoutDuplicate] : [...withoutDuplicate, input];
    queuedTurnsByThread.set(threadId, next);
    scheduleQueueDrain(threadId);
  }

  function deleteQueuedTurn(threadId: string, clientMessageId: string) {
    const existing = queuedTurnsByThread.get(threadId);
    if (!existing?.length) {
      return false;
    }

    const next = existing.filter((turn) => turn.clientMessageId !== clientMessageId);
    if (next.length === existing.length) {
      return false;
    }

    invalidateMessageHistoryCache(threadId);
    if (next.length > 0) {
      queuedTurnsByThread.set(threadId, next);
    } else {
      queuedTurnsByThread.delete(threadId);
      const timer = queueDrainTimers.get(threadId);
      if (timer) {
        clearTimeout(timer);
        queueDrainTimers.delete(threadId);
      }
    }
    return true;
  }

  function updateQueuedTurn(threadId: string, clientMessageId: string, prompt: string) {
    const existing = queuedTurnsByThread.get(threadId);
    if (!existing?.length) {
      return false;
    }

    const index = existing.findIndex((turn) => turn.clientMessageId === clientMessageId);
    if (index < 0) {
      return false;
    }

    invalidateMessageHistoryCache(threadId);
    queuedTurnsByThread.set(
      threadId,
      existing.map((turn, turnIndex) => (turnIndex === index ? { ...turn, prompt } : turn))
    );
    return true;
  }

  function invalidateMessageHistoryCache(threadId: string) {
    conversationStatusCache.delete(threadId);
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

    const locallyStartedTurn = locallyStartedTurnForThread(thread);
    if (isCodexThreadBusy(thread) || locallyStartedTurn) {
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
    const threadWasLoaded = await isThreadLoaded(threadId);
    let activeThread = thread;
    if (threadStatusType(activeThread.status) !== "active") {
      activeThread = (await client.resumeThread({ excludeTurns: false, threadId })).thread;
    }

    await syncPersistedTurnsIntoLoadedModelContext(activeThread, threadWasLoaded);
    const started = await client.startTurn(threadId, userInput(input.prompt, input.attachments), {
      ...PHONE_FULL_ACCESS_TURN_OPTIONS,
      cwd: activeThread.cwd,
      ...turnModelSettings(input.modelSettings)
    });
    rememberModelContextSyncedTurn(threadId, started.turn.id);
    rememberLocallyStartedTurn(threadId, started.turn.id);
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
      const locallyStartedTurn = locallyStartedTurnForThread(thread);

      if (isCodexThreadBusy(thread) || locallyStartedTurn) {
        if (delivery === "steer") {
          const activeTurn = latestActiveTurn(thread);
          const activeTurnId = activeTurn?.id ?? locallyStartedTurn?.turnId ?? null;
          if (!activeTurnId) {
            throw Object.assign(new Error("No active Codex turn is available to steer"), {
              statusCode: 409
            });
          }

          invalidateMessageHistoryCache(threadId);
          const steered = await client.steerTurn(
            threadId,
            userInput(input.prompt, input.attachments),
            activeTurnId
          );
          rememberLocallyStartedTurn(threadId, steered.turnId);
          if (input.clientMessageId) {
            deleteQueuedTurn(threadId, input.clientMessageId);
          }
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

    async deleteQueuedTurn(conversationId, input) {
      const threadId = toCodexThreadId(conversationId);
      const removed = deleteQueuedTurn(threadId, input.clientMessageId);
      return {
        conversationId: externalCodexConversationId(threadId),
        removed,
        status: (queuedTurnsByThread.get(threadId)?.length ?? 0) > 0 ? "queued" : "running"
      };
    },

    async updateQueuedTurn(conversationId, input) {
      const threadId = toCodexThreadId(conversationId);
      const updated = updateQueuedTurn(threadId, input.clientMessageId, input.prompt);
      return {
        conversationId: externalCodexConversationId(threadId),
        status: (queuedTurnsByThread.get(threadId)?.length ?? 0) > 0 ? "queued" : "running",
        updated
      };
    },

    async listCompletionStates() {
      const threads = await hydrateConversationStatusThreads(await loadAllThreads(), {
        hydrateIdleSummaries: false
      });
      const states = threads.map((thread) =>
        codexThreadToCompletionState(thread, workspaceId, {
          forceRunning: Boolean(locallyStartedTurnForThread(thread))
        })
      );
      logDiagnostics(diagnostics, "info", "completion.states.result", {
        activeCount: states.filter((state) => isActiveMobileConversationStatus(state.status))
          .length,
        stateCount: states.length
      });
      return states.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    },

    async listMessages(conversationId, messageOptions = {}) {
      const threadId = toCodexThreadId(conversationId);
      const messages = await readCachedThreadMessages(threadId, {
        afterSequence: messageOptions.afterSequence,
        forceRefresh: messageOptions.forceRefresh === true
      });
      const returned = filterThreadMessages(messages, messageOptions);

      logDiagnostics(diagnostics, "info", "messages.list.bridge_result", {
        ...messageCounts(messages),
        afterSequence: messageOptions.afterSequence,
        conversationId: externalCodexConversationId(threadId),
        forceRefresh: messageOptions.forceRefresh === true,
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
      const threads = await hydrateConversationStatusThreads(await listAllThreads({ cwd }), {
        hydrateIdleSummaries: true
      });
      return threads
        .filter((thread) => externalCodexProjectId(thread.cwd) === projectId)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map((thread) =>
          codexThreadToConversation(thread, workspaceId, userId, {
            forceRunning: Boolean(locallyStartedTurnForThread(thread))
          })
        );
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
      const started = await client.startTurn(
        thread.id,
        userInput(input.prompt, input.attachments),
        {
          ...PHONE_FULL_ACCESS_TURN_OPTIONS,
          cwd,
          ...turnModelSettings(input.modelSettings)
        }
      );
      rememberModelContextSyncedTurn(thread.id, started.turn.id);
      rememberLocallyStartedTurn(thread.id, started.turn.id);

      return {
        conversationId: externalCodexConversationId(thread.id),
        status: "running"
      };
    }
  };

  async function hydrateConversationStatusThreads(
    threads: CodexAppThread[],
    options: { hydrateIdleSummaries: boolean }
  ) {
    return Promise.all(
      threads.map(async (thread) => {
        const cached = conversationStatusCache.get(thread.id);
        if (cached && canUseCachedConversationStatusThread(cached, thread)) {
          return mergeCodexThreadSnapshots(cached.thread, thread);
        }

        if (!needsConversationStatusHydration(thread, options)) {
          return thread;
        }

        const readThread = await client.readThread(thread.id, true).catch(() => thread);
        const mergedThread = mergeCodexThreadSnapshots(readThread, thread);
        conversationStatusCache.set(thread.id, {
          summaryStatusType: threadStatusType(thread.status),
          summaryUpdatedAt: safeSeconds(thread.updatedAt, thread.createdAt),
          thread: mergedThread
        });
        return mergedThread;
      })
    );
  }

  async function readCachedThreadMessages(
    threadId: string,
    options: { afterSequence: number | undefined; forceRefresh: boolean }
  ) {
    const cached = messageHistoryCache.get(threadId);
    if (!options.forceRefresh && typeof options.afterSequence === "number" && cached) {
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

  function canUseCachedConversationStatusThread(
    cached: ConversationStatusCacheEntry,
    summary: CodexAppThread
  ) {
    return (
      cached.summaryStatusType === threadStatusType(summary.status) &&
      cached.summaryUpdatedAt === safeSeconds(summary.updatedAt, summary.createdAt)
    );
  }

  async function isThreadLoaded(threadId: string) {
    try {
      return (await client.listLoadedThreads()).includes(threadId);
    } catch {
      return false;
    }
  }

  async function syncPersistedTurnsIntoLoadedModelContext(
    thread: CodexAppThread,
    threadWasLoaded: boolean
  ) {
    const sync = persistedResponseItemsNeedingModelContextSync(thread, threadWasLoaded);

    if (sync.items.length === 0) {
      logDiagnostics(diagnostics, "info", "codex.context_sync.skipped", {
        mode: sync.mode,
        reason: sync.mode === "not_loaded" ? "thread_not_loaded" : "no_new_persisted_items",
        terminalTurnCount: sync.terminalTurnCount,
        threadId: thread.id,
        threadWasLoaded
      });
      rememberLatestPersistedTurnAsSynced(thread);
      return;
    }

    try {
      await client.injectItems(thread.id, sync.items);
      logDiagnostics(diagnostics, "info", "codex.context_sync.injected", {
        itemCount: sync.items.length,
        mode: sync.mode,
        terminalTurnCount: sync.terminalTurnCount,
        threadId: thread.id,
        threadWasLoaded
      });
    } catch (error) {
      logDiagnostics(diagnostics, "error", "codex.context_sync.failure", {
        error: errorDiagnostics(error),
        itemCount: sync.items.length,
        mode: sync.mode,
        terminalTurnCount: sync.terminalTurnCount,
        threadId: thread.id,
        threadWasLoaded
      });
      throw error;
    }

    rememberLatestPersistedTurnAsSynced(thread);
  }

  function persistedResponseItemsNeedingModelContextSync(
    thread: CodexAppThread,
    threadWasLoaded: boolean
  ) {
    const syncedTurnId = modelContextSyncedTurnIds.get(thread.id);
    const latestTerminalTurns = thread.turns.filter((turn) => isTurnTerminal(turn));

    if (syncedTurnId) {
      const syncedIndex = thread.turns.findIndex((turn) => turn.id === syncedTurnId);

      if (syncedIndex >= 0) {
        const turns = thread.turns.slice(syncedIndex + 1).filter((turn) => isTurnTerminal(turn));
        return {
          items: turnsToResponseItems(turns),
          mode: "tracked_cursor" as const,
          terminalTurnCount: latestTerminalTurns.length
        };
      }
    }

    if (!threadWasLoaded) {
      return {
        items: [],
        mode: "not_loaded" as const,
        terminalTurnCount: latestTerminalTurns.length
      };
    }

    return {
      items: turnsToResponseItems(
        latestTerminalTurns.slice(-MAX_CONTEXT_SYNC_TURNS_WITHOUT_CURSOR),
        { includeAssistant: false }
      ),
      mode: "loaded_without_cursor" as const,
      terminalTurnCount: latestTerminalTurns.length
    };
  }

  function rememberLatestPersistedTurnAsSynced(thread: CodexAppThread) {
    const latestTurn = thread.turns.at(-1);

    if (latestTurn?.id && isTurnTerminal(latestTurn)) {
      rememberModelContextSyncedTurn(thread.id, latestTurn.id);
    }
  }

  function rememberModelContextSyncedTurn(threadId: string, turnId: string | null | undefined) {
    if (turnId) {
      modelContextSyncedTurnIds.set(threadId, turnId);
    }
  }
}

function createCodexAppClient(options: CreateLocalCodexBridgeOptions) {
  const serverUrl = options.serverUrl ?? process.env.CODEX_APP_SERVER_URL ?? DEFAULT_SERVER_URL;
  const codexBinaryPath =
    options.codexBinaryPath ?? process.env.CODEX_APP_BINARY ?? DEFAULT_CODEX_BINARY;
  const diagnostics = options.diagnostics;

  return {
    async injectItems(threadId: string, items: CodexAppResponseItem[]) {
      await callCodexApp(
        serverUrl,
        codexBinaryPath,
        "thread/inject_items",
        {
          items,
          threadId
        },
        diagnostics
      );
    },

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
        if (includeTurns && isUnmaterializedThreadReadError(error)) {
          logDiagnostics(diagnostics, "info", "codex.thread_read.unmaterialized", {
            error: errorDiagnostics(error),
            includeTurns,
            threadId
          });
          logDiagnostics(diagnostics, "info", "codex.thread_read.call", {
            includeTurns: false,
            threadId
          });
          const response = await callCodexApp<{ thread: CodexAppThread }>(
            serverUrl,
            codexBinaryPath,
            "thread/read",
            { includeTurns: false, threadId },
            diagnostics
          );
          logDiagnostics(diagnostics, "info", "codex.thread_read.result", {
            includeTurns: false,
            threadId,
            turnCount: response.thread.turns.length
          });
          return response.thread;
        }

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

function isUnmaterializedThreadReadError(error: unknown) {
  const message = errorDiagnostics(error);
  return (
    message.includes("not materialized yet") &&
    message.includes("includeTurns is unavailable before first user message")
  );
}

async function callCodexApp<TResult>(
  serverUrl: string,
  codexBinaryPath: string,
  method: string,
  params: unknown,
  diagnostics?: MobileControlDiagnosticsLogger
): Promise<TResult> {
  try {
    return await callCodexAppOnce<TResult>(serverUrl, codexBinaryPath, method, params);
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
    return callCodexAppOnce<TResult>(serverUrl, codexBinaryPath, method, params);
  }
}

async function callCodexAppOnce<TResult>(
  serverUrl: string,
  codexBinaryPath: string,
  method: string,
  params: unknown
) {
  const connection = await JsonRpcConnection.connect(serverUrl, codexBinaryPath);

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
    const response = await startTurnWithKeepAliveOnce(
      serverUrl,
      codexBinaryPath,
      threadId,
      input,
      options
    );
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
      const response = await startTurnWithKeepAliveOnce(
        serverUrl,
        codexBinaryPath,
        threadId,
        input,
        options
      );
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
  codexBinaryPath: string,
  threadId: string,
  input: CodexAppUserInput[],
  options: CodexAppStartTurnOptions
) {
  const connection = await JsonRpcConnection.connect(serverUrl, codexBinaryPath);
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
    const response = await steerTurnWithKeepAliveOnce(
      serverUrl,
      codexBinaryPath,
      threadId,
      input,
      expectedTurnId
    );
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
      const response = await steerTurnWithKeepAliveOnce(
        serverUrl,
        codexBinaryPath,
        threadId,
        input,
        expectedTurnId
      );
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
  codexBinaryPath: string,
  threadId: string,
  input: CodexAppUserInput[],
  expectedTurnId: string
) {
  const connection = await JsonRpcConnection.connect(serverUrl, codexBinaryPath);
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
  await connection.initialize(async () => {
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
  });
}

class WebSocketJsonRpcTransport implements JsonRpcTransport {
  private constructor(private readonly socket: WebSocket) {}

  static connect(serverUrl: string) {
    return new Promise<WebSocketJsonRpcTransport>((resolve, reject) => {
      const socket = new WebSocket(serverUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to Codex app-server at ${serverUrl}`));
      }, REQUEST_TIMEOUT_MS);

      socket.once("open", () => {
        clearTimeout(timer);
        resolve(new WebSocketJsonRpcTransport(socket));
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  onMessage(handler: (raw: string) => void) {
    this.socket.on("message", (data) => handler(data.toString()));
  }

  onClose(handler: () => void) {
    this.socket.on("close", handler);
  }

  onError(handler: (error: Error) => void) {
    this.socket.on("error", (error) =>
      handler(error instanceof Error ? error : new Error(String(error)))
    );
  }

  send(payload: string, callback: (error?: Error) => void) {
    this.socket.send(payload, callback);
  }

  close() {
    this.socket.close();
  }
}

class StdioJsonRpcTransport implements JsonRpcTransport {
  private readonly closeHandlers = new Set<() => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private readonly messageHandlers = new Set<(raw: string) => void>();
  private closed = false;
  private lastStderr = "";

  private constructor(private readonly child: ChildProcess) {
    if (!child.stdout || !child.stdin) {
      throw new Error("Codex app-server stdio pipes are unavailable");
    }

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.emitMessage(line));
    child.stderr?.on("data", (chunk) => {
      this.lastStderr = trimStderr(`${this.lastStderr}${chunk.toString()}`);
    });
    child.once("error", (error) =>
      this.emitError(error instanceof Error ? error : new Error(String(error)))
    );
    child.once("exit", (code, signal) => {
      this.closed = true;
      if (code && code !== 0) {
        this.emitError(
          new Error(
            `Codex app-server exited with code ${code}${this.lastStderr ? `: ${this.lastStderr}` : ""}`
          )
        );
      } else if (signal) {
        this.emitError(new Error(`Codex app-server exited with signal ${signal}`));
      }
      this.emitClose();
    });
  }

  static connect(codexBinaryPath: string) {
    return new Promise<StdioJsonRpcTransport>((resolve, reject) => {
      const child = spawn(
        codexBinaryPath,
        ["app-server", "--listen", "stdio://", "--analytics-default-enabled"],
        {
          stdio: ["pipe", "pipe", "pipe"]
        }
      );
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill("SIGTERM");
          reject(new Error("Timed out starting Codex app-server stdio transport"));
        }
      }, REQUEST_TIMEOUT_MS);

      child.once("spawn", () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          resolve(new StdioJsonRpcTransport(child));
        } catch (error) {
          child.kill("SIGTERM");
          reject(error);
        }
      });
      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Codex app-server exited before stdio transport opened (${code ?? signal})`));
      });
    });
  }

  onMessage(handler: (raw: string) => void) {
    this.messageHandlers.add(handler);
  }

  onClose(handler: () => void) {
    this.closeHandlers.add(handler);
  }

  onError(handler: (error: Error) => void) {
    this.errorHandlers.add(handler);
  }

  send(payload: string, callback: (error?: Error) => void) {
    if (this.closed || !this.child.stdin?.writable) {
      callback(new Error("Codex app-server stdio transport is closed"));
      return;
    }

    this.child.stdin.write(`${payload}\n`, (error) => callback(error ?? undefined));
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.child.stdin?.end();
    this.child.kill("SIGTERM");
  }

  private emitMessage(raw: string) {
    for (const handler of this.messageHandlers) {
      handler(raw);
    }
  }

  private emitClose() {
    for (const handler of this.closeHandlers) {
      handler();
    }
    this.closeHandlers.clear();
  }

  private emitError(error: Error) {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }
}

class JsonRpcConnection {
  private readonly pending = new Map<
    number,
    { reject(error: Error): void; resolve(value: unknown): void; timer: NodeJS.Timeout }
  >();
  private readonly notificationHandlers = new Set<(method: string, params: unknown) => void>();
  private readonly closeHandlers = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private initialized = false;

  private constructor(
    private readonly transport: JsonRpcTransport,
    private readonly closeTransportOnClose = true
  ) {
    transport.onMessage((data) => this.handleMessage(data));
    transport.onClose(() => {
      this.rejectAll(new Error("Codex app-server connection closed"));
      for (const handler of this.closeHandlers) {
        handler();
      }
      this.closeHandlers.clear();
    });
    transport.onError((error) => this.rejectAll(error));
  }

  static async connect(serverUrl: string, codexBinaryPath: string) {
    if (isStdioServerUrl(serverUrl)) {
      return JsonRpcConnection.sharedStdio(codexBinaryPath);
    }

    return new JsonRpcConnection(await WebSocketJsonRpcTransport.connect(serverUrl));
  }

  private static sharedStdio(codexBinaryPath: string) {
    const key = normalize(codexBinaryPath);
    const existing = sharedStdioConnections.get(key);
    if (existing) {
      return existing;
    }

    const promise = StdioJsonRpcTransport.connect(codexBinaryPath)
      .then((transport) => {
        const connection = new JsonRpcConnection(transport, false);
        connection.onClose(() => {
          if (sharedStdioConnections.get(key) === promise) {
            sharedStdioConnections.delete(key);
          }
        });
        return connection;
      })
      .catch((error) => {
        if (sharedStdioConnections.get(key) === promise) {
          sharedStdioConnections.delete(key);
        }
        throw error;
      });

    sharedStdioConnections.set(key, promise);
    return promise;
  }

  initialize(initializer: () => Promise<void>) {
    if (this.initialized) {
      return Promise.resolve();
    }

    if (!this.initialization) {
      this.initialization = initializer()
        .then(() => {
          this.initialized = true;
        })
        .finally(() => {
          this.initialization = null;
        });
    }

    return this.initialization;
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
      this.transport.send(payload, (error) => {
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
    this.transport.send(
      JSON.stringify(params === undefined ? { method } : { method, params }),
      () => undefined
    );
  }

  close() {
    if (this.closeTransportOnClose) {
      this.transport.close();
    }
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

function isStdioServerUrl(serverUrl: string) {
  try {
    return new URL(serverUrl).protocol === "stdio:";
  } catch {
    return false;
  }
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

function trimStderr(value: string) {
  return value.trim().slice(-2_000);
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

function needsConversationStatusHydration(
  thread: CodexAppThread,
  options: { hydrateIdleSummaries: boolean }
) {
  return (
    thread.turns.length === 0 &&
    (threadStatusType(thread.status) === "active" ||
      thread.abitatLoadedFromAppServer === true ||
      (options.hydrateIdleSummaries && isThreadListActivitySummaryStatus(thread.status)))
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
  userId: string,
  options: { forceRunning?: boolean } = {}
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
    status: codexThreadToConversationStatus(thread, options),
    type: "investigation",
    updatedAt: secondsToIso(safeSeconds(thread.updatedAt, thread.createdAt)),
    workspaceId,
    worktreePath: thread.cwd
  };
}

function codexThreadToCompletionState(
  thread: CodexAppThread,
  workspaceId: string,
  options: { forceRunning?: boolean } = {}
) {
  const latestTurn = thread.turns.at(-1) ?? null;
  const status = codexThreadToConversationStatus(thread, options);
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
        if (
          !HIDDEN_CODEX_ITEM_TYPES.has(item.type) &&
          !isKnownCodexItemType(item.type) &&
          !unknownItemTypes.has(item.type)
        ) {
          logDiagnostics(diagnostics, "warn", "codex.thread_item.unknown", {
            codexItemId: item.id,
            codexItemType: item.type,
            conversationId,
            threadId: thread.id,
            turnId: turn.id
          });
          unknownItemTypes.add(item.type);
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

function recordField(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const field = (value as Record<string, unknown>)[key];
  return field && typeof field === "object" ? (field as Record<string, unknown>) : null;
}

function summarizedStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const field = stringField(value as Record<string, unknown>, key);
  return field ? summarizeInlineContent(field) : null;
}

function summarizeInlineContent(content: string) {
  const normalized = content.replace(/\s+/gu, " ").trim();
  if (normalized.length <= MAX_CODEX_ITEM_SUMMARY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_CODEX_ITEM_SUMMARY_LENGTH)}...`;
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

function codexThreadToConversationStatus(
  thread: CodexAppThread,
  options: { forceRunning?: boolean } = {}
): ConversationStatus {
  if (options.forceRunning) {
    return "running";
  }

  const latestTurn = thread.turns.at(-1) ?? null;

  if (threadStatusType(thread.status) === "active") {
    if (latestTurn && isTurnCompleted(latestTurn)) {
      return "approved";
    }

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
  const latestTurn = thread.turns.at(-1) ?? null;
  return (
    (threadStatusType(thread.status) === "active" &&
      !(latestTurn && isTurnCompleted(latestTurn))) ||
    Boolean(latestTurn && isTurnInProgress(latestTurn))
  );
}

function isCodexThreadMessageHistoryStable(thread: CodexAppThread) {
  return !isCodexThreadBusy(thread);
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

  if (item.type === "imageGeneration") {
    return {
      content: imageGenerationSummary(item),
      role: "assistant"
    };
  }

  if (item.type === "webSearch") {
    return {
      content: webSearchSummary(item),
      role: "runtime"
    };
  }

  if (item.type === "imageView") {
    return {
      content: "Viewed an image.",
      role: "runtime"
    };
  }

  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
    return {
      content: toolCallSummary(item),
      role: "runtime"
    };
  }

  if (item.type === "collabAgentToolCall") {
    return {
      content: collabAgentToolCallSummary(item),
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
    type === "imageGeneration" ||
    type === "imageView" ||
    type === "webSearch" ||
    type === "mcpToolCall" ||
    type === "dynamicToolCall" ||
    type === "collabAgentToolCall" ||
    HIDDEN_CODEX_ITEM_TYPES.has(type)
  );
}

function imageGenerationSummary(item: CodexAppThreadItem) {
  const prompt = summarizedStringField(item, "prompt") ?? summarizedStringField(item, "userPrompt");
  const savedPath =
    summarizedStringField(item, "savedPath") ??
    summarizedStringField(item, "saved_path") ??
    summarizedStringField(item, "path");

  if (prompt && savedPath) {
    return `Generated an image: ${prompt}. Saved to ${savedPath}.`;
  }

  if (prompt) {
    return `Generated an image: ${prompt}.`;
  }

  if (savedPath) {
    return `Generated an image: ${savedPath}.`;
  }

  return "Generated an image.";
}

function webSearchSummary(item: CodexAppThreadItem) {
  const action = recordField(item, "action");
  const query =
    summarizedStringField(item, "query") ??
    summarizedStringField(action, "query") ??
    summarizedStringField(item, "url") ??
    summarizedStringField(action, "url");

  return query ? `Searched the web: ${query}.` : "Searched the web.";
}

function toolCallSummary(item: CodexAppThreadItem) {
  const toolName =
    summarizedStringField(item, "name") ??
    summarizedStringField(item, "toolName") ??
    summarizedStringField(item, "tool_name") ??
    summarizedStringField(item, "serverName") ??
    summarizedStringField(item, "server_name");

  return toolName ? `Used tool: ${toolName}.` : "Used a tool.";
}

function collabAgentToolCallSummary(item: CodexAppThreadItem) {
  const name =
    summarizedStringField(item, "name") ??
    summarizedStringField(item, "toolName") ??
    summarizedStringField(item, "agentPath") ??
    summarizedStringField(item, "agent_path");

  return name ? `Used collaboration tool: ${name}.` : "Used a collaboration tool.";
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

function turnsToResponseItems(
  turns: CodexAppTurn[],
  options: { includeAssistant?: boolean } = {}
): CodexAppResponseItem[] {
  const includeAssistant = options.includeAssistant ?? true;

  return turns.flatMap((turn) =>
    turn.items.flatMap((item) => threadItemToResponseItems(item, { includeAssistant }))
  );
}

function threadItemToResponseItems(
  item: CodexAppThreadItem,
  options: { includeAssistant: boolean }
): CodexAppResponseItem[] {
  if (item.type === "userMessage") {
    const userMessage = item as { content?: CodexAppUserInput[] };
    const content = Array.isArray(userMessage.content)
      ? userMessage.content.flatMap(userInputToResponseContent)
      : [];

    return content.length > 0 ? [{ content, role: "user", type: "message" }] : [];
  }

  if (!options.includeAssistant) {
    return [];
  }

  if (item.type === "agentMessage") {
    const text = safeString((item as { text?: string }).text).trim();

    return text
      ? [
          {
            content: [{ text: truncateMessageContent(text), type: "output_text" }],
            role: "assistant",
            type: "message"
          }
        ]
      : [];
  }

  if (item.type === "plan") {
    const text = safeString((item as { text?: string }).text).trim();

    return text
      ? [
          {
            content: [{ text: truncateMessageContent(text), type: "output_text" }],
            role: "assistant",
            type: "message"
          }
        ]
      : [];
  }

  return [];
}

function userInputToResponseContent(input: CodexAppUserInput): CodexAppResponseItem["content"] {
  const text = userInputToText(input).trim();

  return text ? [{ text: truncateMessageContent(text), type: "input_text" }] : [];
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
