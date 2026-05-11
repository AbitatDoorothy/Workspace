import type { LocalCodexCompletionState } from "./server.js";
import type { LocalPushSubscription } from "./state.js";
import {
  errorDiagnostics,
  logDiagnostics,
  type MobileControlDiagnosticsLogger
} from "./diagnostics-log.js";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const DEFAULT_COMPLETION_POLL_INTERVAL_MS = 5_000;

export type { LocalPushSubscription };

export interface LocalPushMessage {
  body: string;
  data: Record<string, string>;
  interruptionLevel: "time-sensitive";
  priority: "high";
  sound: string;
  title: string;
  to: string;
}

export interface LocalMobilePushTransport {
  send(messages: LocalPushMessage[]): Promise<void>;
}

interface LocalPushSubscriptionStore {
  listPushSubscriptions(): Promise<LocalPushSubscription[]>;
}

interface LocalCompletionCodex {
  listCompletionStates(): Promise<LocalCodexCompletionState[]>;
}

interface LocalCompletionPushService {
  sendCodexThreadDone(input: {
    conversationId: string;
    failed: boolean;
    projectId: string;
    projectName?: string;
    prompt: string;
    source: "codex_app";
    status: string;
    turnId: string;
    workspaceId: string;
  }): Promise<number>;
}

interface LocalCompletionNotifierOptions {
  codex: LocalCompletionCodex;
  diagnostics?: MobileControlDiagnosticsLogger;
  intervalMs?: number;
  logger?: Pick<Console, "info" | "warn">;
  mobilePushService: LocalCompletionPushService;
  now?: () => Date;
}

interface CompletionSnapshot {
  isComplete: boolean;
  latestTurnCompletedAt: string | null;
  latestTurnId: string | null;
  status: string;
  updatedAt: string;
}

export const CODEX_COMPLETION_NOTIFICATION_SOUNDS = [
  "codex-done-1.wav",
  "codex-done-2.wav",
  "codex-done-3.wav"
] as const;

export function createLocalMobilePushService(
  subscriptionStore: LocalPushSubscriptionStore,
  options: {
    diagnostics?: MobileControlDiagnosticsLogger;
    logger?: Pick<Console, "info" | "warn">;
    soundPicker?: () => string;
    transport?: LocalMobilePushTransport;
  } = {}
) {
  const transport = options.transport ?? createExpoPushTransport();
  const soundPicker = options.soundPicker ?? randomCodexCompletionSound;

  return {
    async sendCodexThreadDone(
      input: Parameters<LocalCompletionPushService["sendCodexThreadDone"]>[0]
    ) {
      const subscriptions = (await subscriptionStore.listPushSubscriptions()).filter(
        (subscription) => subscription.provider === "expo"
      );
      const uniqueSubscriptions = uniquePushSubscriptionsByToken(subscriptions);
      const messages = uniqueSubscriptions.map((subscription) => {
        const sound = soundPicker();

        return {
          body: `Project: ${(input.projectName ?? "").trim() || "Unknown project"}`,
          data: {
            conversationId: input.conversationId,
            failed: String(input.failed),
            projectId: input.projectId,
            projectName: input.projectName ?? "",
            prompt: input.prompt,
            sound,
            source: input.source,
            status: input.status,
            turnId: input.turnId,
            workspaceId: input.workspaceId
          },
          interruptionLevel: "time-sensitive" as const,
          priority: "high" as const,
          sound,
          title: `Codex thread ${input.failed ? "failed" : "done"}`,
          to: subscription.token
        };
      });

      if (messages.length === 0) {
        logDiagnostics(options.diagnostics, "info", "push.send.skipped", {
          conversationId: input.conversationId,
          projectId: input.projectId,
          reason: "no_subscriptions",
          turnId: input.turnId
        });
        return 0;
      }

      try {
        await transport.send(messages);
      } catch (error) {
        logDiagnostics(options.diagnostics, "error", "push.send.failure", {
          conversationId: input.conversationId,
          error: errorDiagnostics(error),
          projectId: input.projectId,
          sentCount: 0,
          subscriptionCount: subscriptions.length,
          turnId: input.turnId
        });
        throw error;
      }
      logDiagnostics(options.diagnostics, "info", "push.send.success", {
        conversationId: input.conversationId,
        failed: input.failed,
        projectId: input.projectId,
        duplicateSubscriptionCount: subscriptions.length - messages.length,
        sentCount: messages.length,
        status: input.status,
        subscriptionCount: subscriptions.length,
        turnId: input.turnId
      });
      options.logger?.info(
        `[mobile-push] Sent ${messages.length} Codex completion push notification${
          messages.length === 1 ? "" : "s"
        } for ${input.conversationId}.`
      );
      return messages.length;
    }
  };
}

export function createLocalCodexCompletionNotifier(options: LocalCompletionNotifierOptions) {
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
      logDiagnostics(options.diagnostics, "debug", "completion.poll.start");
      const states = await options.codex.listCompletionStates();
      logDiagnostics(options.diagnostics, "info", "completion.poll.result", {
        completeCount: states.filter((state) => state.isComplete).length,
        conversationId: states.length === 1 ? states[0]?.conversationId : undefined,
        stateCount: states.length
      });

      if (!hasBootstrapped) {
        for (const state of states) {
          snapshots.set(state.conversationId, snapshotCompletion(state));
          await handleCompletionNotification(state, undefined, completionKey(state));
        }
        hasBootstrapped = true;
        return;
      }

      const visibleConversationIds = new Set(states.map((state) => state.conversationId));
      for (const state of states) {
        const previous = snapshots.get(state.conversationId);
        snapshots.set(state.conversationId, snapshotCompletion(state));
        await handleCompletionNotification(state, previous, completionKey(state));
      }

      for (const conversationId of snapshots.keys()) {
        if (!visibleConversationIds.has(conversationId)) {
          snapshots.delete(conversationId);
        }
      }
    } catch (error) {
      logDiagnostics(options.diagnostics, "error", "completion.poll.failure", {
        error: errorDiagnostics(error)
      });
      throw error;
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

  async function handleCompletionNotification(
    state: LocalCodexCompletionState,
    previous: CompletionSnapshot | undefined,
    key: string
  ) {
    if (notifiedCompletionKeys.has(key)) {
      logDiagnostics(options.diagnostics, "info", "push.send.skipped", {
        conversationId: state.conversationId,
        reason: "already_notified",
        turnId: state.latestTurnId
      });
      return;
    }

    const skipReason = completionNotificationSkipReason(state, previous, startedAtMs);
    if (skipReason) {
      logDiagnostics(options.diagnostics, "info", "push.send.skipped", {
        conversationId: state.conversationId,
        reason: skipReason,
        status: state.status,
        turnId: state.latestTurnId
      });
      if (shouldResolveSkippedCompletion(skipReason)) {
        notifiedCompletionKeys.add(key);
      }
      return;
    }

    const sentCount = await options.mobilePushService.sendCodexThreadDone({
      conversationId: state.conversationId,
      failed: state.failed,
      projectId: state.projectId,
      projectName: state.projectName,
      prompt: state.prompt,
      source: state.source,
      status: state.status,
      turnId: state.latestTurnId ?? "unknown",
      workspaceId: state.workspaceId
    });

    if (sentCount > 0) {
      notifiedCompletionKeys.add(key);
    }
  }

  return {
    pollOnce,
    start
  };
}

export function createExpoPushTransport(
  fetchFn: typeof fetch = fetch,
  endpoint = EXPO_PUSH_ENDPOINT
): LocalMobilePushTransport {
  return {
    async send(messages) {
      for (const chunk of chunkMessages(messages, 100)) {
        const response = await fetchFn(endpoint, {
          body: JSON.stringify(chunk),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        });

        if (!response.ok) {
          throw new Error(
            `Expo push failed with HTTP ${response.status}: ${await readResponseText(response)}`
          );
        }

        const ticketErrors = expoPushTicketErrors(await readResponseJson(response));
        if (ticketErrors.length > 0) {
          throw new Error(`Expo push failed: ${ticketErrors.join("; ")}`);
        }
      }
    }
  };
}

export function randomCodexCompletionSound(random = Math.random) {
  const index = Math.floor(random() * CODEX_COMPLETION_NOTIFICATION_SOUNDS.length);
  return CODEX_COMPLETION_NOTIFICATION_SOUNDS[
    Math.max(0, Math.min(index, CODEX_COMPLETION_NOTIFICATION_SOUNDS.length - 1))
  ];
}

function completionNotificationSkipReason(
  state: LocalCodexCompletionState,
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

function completionHappenedAfter(state: LocalCodexCompletionState, timestampMs: number) {
  const completedAtMs = Date.parse(state.latestTurnCompletedAt ?? state.updatedAt);

  return Number.isFinite(completedAtMs) && completedAtMs >= timestampMs;
}

function snapshotCompletion(state: LocalCodexCompletionState): CompletionSnapshot {
  return {
    isComplete: state.isComplete,
    latestTurnCompletedAt: state.latestTurnCompletedAt,
    latestTurnId: state.latestTurnId,
    status: state.status,
    updatedAt: state.updatedAt
  };
}

function completionKey(state: LocalCodexCompletionState) {
  return [state.conversationId, state.latestTurnId ?? "unknown"].join(":");
}

function uniquePushSubscriptionsByToken(subscriptions: LocalPushSubscription[]) {
  const seenTokens = new Set<string>();
  const uniqueSubscriptions: LocalPushSubscription[] = [];

  for (const subscription of subscriptions) {
    if (seenTokens.has(subscription.token)) {
      continue;
    }

    seenTokens.add(subscription.token);
    uniqueSubscriptions.push(subscription);
  }

  return uniqueSubscriptions;
}

async function readResponseJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function readResponseText(response: Response) {
  try {
    return await response.text();
  } catch {
    return "<unreadable response body>";
  }
}

function expoPushTicketErrors(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const data = (payload as { data?: unknown }).data;
  const tickets = Array.isArray(data) ? data : [data];

  return tickets.flatMap((ticket) => {
    if (!ticket || typeof ticket !== "object") {
      return [];
    }

    const candidate = ticket as {
      details?: { error?: unknown };
      message?: unknown;
      status?: unknown;
    };
    if (candidate.status !== "error") {
      return [];
    }

    const errorCode =
      typeof candidate.details?.error === "string" ? candidate.details.error : "Unknown";
    const message = typeof candidate.message === "string" ? candidate.message : "No message";

    return [`${errorCode}: ${message}`];
  });
}

function chunkMessages<T>(messages: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }

  return chunks;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
