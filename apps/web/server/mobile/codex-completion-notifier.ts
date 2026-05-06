import type { ConversationStatus } from "@abitat/shared";

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

interface CodexCompletionNotifierCodexService {
  listCompletionStates(): Promise<CodexCompletionState[]>;
}

interface CodexCompletionNotifierPushService {
  sendCodexThreadDone(input: {
    conversationId: string;
    failed: boolean;
    hostMachineId: string;
    projectId: string;
    prompt: string;
    source: "codex_app";
    turnId: string;
    workspaceId: string;
  }): Promise<number>;
}

interface CodexCompletionNotifierLogger {
  warn(message: string): void;
}

interface CodexCompletionNotifierOptions {
  codexAppService: CodexCompletionNotifierCodexService;
  hostMachineId: string;
  intervalMs?: number;
  logger?: CodexCompletionNotifierLogger;
  mobilePushService: CodexCompletionNotifierPushService;
  now?: () => Date;
}

interface CompletionSnapshot {
  isComplete: boolean;
  latestTurnCompletedAt: string | null;
  latestTurnId: string | null;
  status: ConversationStatus;
  updatedAt: string;
}

const DEFAULT_COMPLETION_POLL_INTERVAL_MS = 5_000;

export function createCodexCompletionNotifier(options: CodexCompletionNotifierOptions) {
  const snapshots = new Map<string, CompletionSnapshot>();
  const notifiedCompletionKeys = new Set<string>();
  const startedAtMs = (options.now ?? (() => new Date()))().getTime();
  let hasBootstrapped = false;
  let isPolling = false;

  async function pollOnce() {
    if (isPolling) {
      return;
    }

    isPolling = true;
    try {
      const states = await options.codexAppService.listCompletionStates();

      if (!hasBootstrapped) {
        for (const state of states) {
          snapshots.set(state.conversationId, snapshotCompletion(state));
          const key = completionKey(state);
          if (state.isComplete && completionHappenedAfter(state, startedAtMs)) {
            await options.mobilePushService.sendCodexThreadDone({
              conversationId: state.conversationId,
              failed: state.failed,
              hostMachineId: options.hostMachineId,
              projectId: state.projectId,
              prompt: state.prompt,
              source: state.source,
              turnId: state.latestTurnId ?? "unknown",
              workspaceId: state.workspaceId
            });
            notifiedCompletionKeys.add(key);
          } else if (state.isComplete) {
            notifiedCompletionKeys.add(key);
          }
        }
        hasBootstrapped = true;
        return;
      }

      const visibleConversationIds = new Set(states.map((state) => state.conversationId));
      for (const state of states) {
        const previous = snapshots.get(state.conversationId);
        const key = completionKey(state);

        snapshots.set(state.conversationId, snapshotCompletion(state));

        if (
          shouldNotifyForCompletion(state, previous, startedAtMs) &&
          !notifiedCompletionKeys.has(key)
        ) {
          await options.mobilePushService.sendCodexThreadDone({
            conversationId: state.conversationId,
            failed: state.failed,
            hostMachineId: options.hostMachineId,
            projectId: state.projectId,
            prompt: state.prompt,
            source: state.source,
            turnId: state.latestTurnId ?? "unknown",
            workspaceId: state.workspaceId
          });
          notifiedCompletionKeys.add(key);
        }
      }

      for (const conversationId of snapshots.keys()) {
        if (!visibleConversationIds.has(conversationId)) {
          snapshots.delete(conversationId);
        }
      }
    } finally {
      isPolling = false;
    }
  }

  function start() {
    void pollOnce().catch((error) => {
      options.logger?.warn(
        `[mobile-push] Codex completion notification poll failed: ${errorMessage(error)}`
      );
    });
    const interval = setInterval(() => {
      void pollOnce().catch((error) => {
        options.logger?.warn(
          `[mobile-push] Codex completion notification poll failed: ${errorMessage(error)}`
        );
      });
    }, options.intervalMs ?? DEFAULT_COMPLETION_POLL_INTERVAL_MS);
    interval.unref?.();

    return () => clearInterval(interval);
  }

  return {
    pollOnce,
    start
  };
}

function shouldNotifyForCompletion(
  state: CodexCompletionState,
  previous: CompletionSnapshot | undefined,
  startedAtMs: number
) {
  if (!state.isComplete || !state.latestTurnId) {
    return false;
  }

  if (!previous) {
    return completionHappenedAfter(state, startedAtMs);
  }

  if (previous.latestTurnId === state.latestTurnId) {
    return !previous.isComplete;
  }

  return completionHappenedAfter(state, startedAtMs);
}

function completionHappenedAfter(state: CodexCompletionState, timestampMs: number) {
  const completedAtMs = Date.parse(state.latestTurnCompletedAt ?? state.updatedAt);

  return Number.isFinite(completedAtMs) && completedAtMs >= timestampMs;
}

function snapshotCompletion(state: CodexCompletionState): CompletionSnapshot {
  return {
    isComplete: state.isComplete,
    latestTurnCompletedAt: state.latestTurnCompletedAt,
    latestTurnId: state.latestTurnId,
    status: state.status,
    updatedAt: state.updatedAt
  };
}

function completionKey(state: CodexCompletionState) {
  return [
    state.conversationId,
    state.latestTurnId ?? "unknown",
    state.latestTurnCompletedAt ?? state.updatedAt
  ].join(":");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
