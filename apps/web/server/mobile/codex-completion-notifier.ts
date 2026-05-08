import type { ConversationStatus } from "@abitat/shared";
import type { MobileActivityLog } from "./mobile-activity-log";

export interface CodexCompletionState {
  conversationId: string;
  failed: boolean;
  isComplete: boolean;
  latestTurnCompletedAt: string | null;
  latestTurnId: string | null;
  projectId: string;
  projectName: string;
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
    projectName: string;
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
  activityLog?: Pick<MobileActivityLog, "record">;
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
const DEFAULT_HOST_MACHINE_ID = "machine_demo";

export function createCodexCompletionNotifier(options: CodexCompletionNotifierOptions) {
  const snapshots = new Map<string, CompletionSnapshot>();
  const notifiedCompletionKeys = new Set<string>();
  const startedAtMs = (options.now ?? (() => new Date()))().getTime();
  const hostMachineId = normalizeHostMachineId(options.hostMachineId);
  let hasBootstrapped = false;
  let isPolling = false;

  async function pollOnce() {
    if (isPolling) {
      return;
    }

    isPolling = true;
    try {
      const states = await options.codexAppService.listCompletionStates();
      recordActivity("codex_completion_poll_loaded", {
        bootstrapping: !hasBootstrapped,
        stateCount: states.length
      });

      if (!hasBootstrapped) {
        for (const state of states) {
          snapshots.set(state.conversationId, snapshotCompletion(state));
          const key = completionKey(state);
          await handleCompletionNotification(state, undefined, key);
        }
        hasBootstrapped = true;
        return;
      }

      const visibleConversationIds = new Set(states.map((state) => state.conversationId));
      for (const state of states) {
        const previous = snapshots.get(state.conversationId);
        const key = completionKey(state);

        snapshots.set(state.conversationId, snapshotCompletion(state));
        recordStateChange(state, previous);

        await handleCompletionNotification(state, previous, key);
      }

      for (const conversationId of snapshots.keys()) {
        if (!visibleConversationIds.has(conversationId)) {
          snapshots.delete(conversationId);
          recordActivity("codex_completion_state_removed", { conversationId });
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

  function sendCompletionPush(state: CodexCompletionState) {
    return options.mobilePushService.sendCodexThreadDone({
      conversationId: state.conversationId,
      failed: state.failed,
      hostMachineId,
      projectId: state.projectId,
      projectName: state.projectName,
      prompt: state.prompt,
      source: state.source,
      turnId: state.latestTurnId ?? "unknown",
      workspaceId: state.workspaceId
    });
  }

  async function handleCompletionNotification(
    state: CodexCompletionState,
    previous: CompletionSnapshot | undefined,
    key: string
  ) {
    if (notifiedCompletionKeys.has(key)) {
      return;
    }

    const skipReason = completionNotificationSkipReason(state, previous, startedAtMs);

    if (skipReason) {
      recordActivity("codex_completion_notification_skipped", {
        conversationId: state.conversationId,
        reason: skipReason,
        status: state.status,
        turnId: state.latestTurnId ?? "unknown"
      });

      if (shouldResolveSkippedCompletion(skipReason)) {
        notifiedCompletionKeys.add(key);
      }
      return;
    }

    let sentCount: number;
    try {
      sentCount = await sendCompletionPush(state);
    } catch (error) {
      recordActivity("codex_completion_notification_failed", {
        conversationId: state.conversationId,
        error: errorMessage(error),
        failed: state.failed,
        status: state.status,
        turnId: state.latestTurnId ?? "unknown"
      });
      throw error;
    }

    if (sentCount > 0) {
      notifiedCompletionKeys.add(key);
      recordActivity("codex_completion_notification_sent", {
        conversationId: state.conversationId,
        failed: state.failed,
        sentCount,
        status: state.status,
        turnId: state.latestTurnId ?? "unknown"
      });
      return;
    }

    recordActivity("codex_completion_notification_deferred", {
      conversationId: state.conversationId,
      reason: "no_push_subscriptions",
      status: state.status,
      turnId: state.latestTurnId ?? "unknown"
    });
  }

  function recordStateChange(
    state: CodexCompletionState,
    previous: CompletionSnapshot | undefined
  ) {
    if (!previous || snapshotsEqual(previous, state)) {
      return;
    }

    recordActivity("codex_completion_state_changed", {
      conversationId: state.conversationId,
      failed: state.failed,
      isComplete: state.isComplete,
      previousIsComplete: previous.isComplete,
      previousStatus: previous.status,
      previousTurnId: previous.latestTurnId,
      status: state.status,
      turnId: state.latestTurnId
    });
  }

  function recordActivity(event: string, details: Record<string, unknown> = {}) {
    options.activityLog?.record(event, {
      hostMachineId,
      ...details
    });
  }

  return {
    pollOnce,
    start
  };
}

function normalizeHostMachineId(hostMachineId: string) {
  return hostMachineId.trim() || DEFAULT_HOST_MACHINE_ID;
}

function completionNotificationSkipReason(
  state: CodexCompletionState,
  previous: CompletionSnapshot | undefined,
  startedAtMs: number
) {
  if (!state.isComplete) {
    return "not_complete";
  }

  if (!state.latestTurnId) {
    return "missing_turn_id";
  }

  if (state.status === "cancelled") {
    return "cancelled";
  }

  if (!previous) {
    return completionHappenedAfter(state, startedAtMs) ? null : "before_notifier_start";
  }

  if (previous.latestTurnId === state.latestTurnId) {
    if (!previous.isComplete || completionHappenedAfter(state, startedAtMs)) {
      return null;
    }

    return "already_completed_before_start";
  }

  return completionHappenedAfter(state, startedAtMs) ? null : "before_notifier_start";
}

function shouldResolveSkippedCompletion(reason: string) {
  return !["missing_turn_id", "not_complete"].includes(reason);
}

function snapshotsEqual(previous: CompletionSnapshot, state: CodexCompletionState) {
  return (
    previous.isComplete === state.isComplete &&
    previous.latestTurnCompletedAt === state.latestTurnCompletedAt &&
    previous.latestTurnId === state.latestTurnId &&
    previous.status === state.status &&
    previous.updatedAt === state.updatedAt
  );
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
