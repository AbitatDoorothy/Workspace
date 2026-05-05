import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";

import type { ApiClient } from "../api/client";
import type { CodexCompletionSummary } from "../types";

const FOREGROUND_COMPLETION_POLL_INTERVAL_MS = 5000;

let notificationPermissionPromise: Promise<boolean> | null = null;

interface CompletionSnapshot {
  isComplete: boolean;
  latestTurnCompletedAt: string | null;
  latestTurnId: string | null;
  updatedAt: string;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export function rememberRunningConversation(_conversationId: string) {
  // Server-side Codex turn completion push handles notifications, including killed-app delivery.
}

export function useThreadCompletionNotifications(api: ApiClient, isEnabled: boolean) {
  const registeredTokenRef = useRef<string | null>(null);
  const completionSnapshotsRef = useRef(new Map<string, CompletionSnapshot>());
  const notifiedCompletionKeysRef = useRef(new Set<string>());
  const hasBootstrappedCompletionPollRef = useRef(false);
  const isPollingCompletionsRef = useRef(false);

  useEffect(() => {
    if (!isEnabled) {
      registeredTokenRef.current = null;
      completionSnapshotsRef.current.clear();
      notifiedCompletionKeysRef.current.clear();
      hasBootstrappedCompletionPollRef.current = false;
      return;
    }

    let cancelled = false;

    async function registerForPushNotifications() {
      try {
        if (!(await ensureNotificationPermission())) {
          return;
        }

        const token = await Notifications.getExpoPushTokenAsync(pushTokenOptions());
        if (cancelled || registeredTokenRef.current === token.data) {
          return;
        }

        await api.registerPushToken({
          platform: "ios",
          provider: "expo",
          token: token.data
        });
        registeredTokenRef.current = token.data;
      } catch {
        // Push registration is best-effort; foreground polling below is a backup.
      }
    }

    async function pollCompletionsForForegroundFallback() {
      if (cancelled || isPollingCompletionsRef.current) {
        return;
      }

      isPollingCompletionsRef.current = true;
      try {
        const states = await api.listCompletionStates();

        if (!hasBootstrappedCompletionPollRef.current) {
          for (const state of states) {
            completionSnapshotsRef.current.set(state.conversationId, snapshotCompletion(state));
            if (state.isComplete) {
              notifiedCompletionKeysRef.current.add(completionKey(state));
            }
          }
          hasBootstrappedCompletionPollRef.current = true;
          return;
        }

        const visibleConversationIds = new Set(states.map((state) => state.conversationId));
        for (const state of states) {
          const previous = completionSnapshotsRef.current.get(state.conversationId);
          const key = completionKey(state);

          completionSnapshotsRef.current.set(state.conversationId, snapshotCompletion(state));

          if (
            shouldNotifyForCompletedTurn(state, previous) &&
            !notifiedCompletionKeysRef.current.has(key)
          ) {
            await sendForegroundThreadDoneNotification(state);
            notifiedCompletionKeysRef.current.add(key);
          }
        }

        for (const conversationId of completionSnapshotsRef.current.keys()) {
          if (!visibleConversationIds.has(conversationId)) {
            completionSnapshotsRef.current.delete(conversationId);
          }
        }
      } catch {
        // Completion polling is best-effort; the next interval will retry.
      } finally {
        isPollingCompletionsRef.current = false;
      }
    }

    void registerForPushNotifications();
    void pollCompletionsForForegroundFallback();
    const interval = setInterval(() => {
      void pollCompletionsForForegroundFallback();
    }, FOREGROUND_COMPLETION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api, isEnabled]);
}

function pushTokenOptions() {
  const constants = Constants as typeof Constants & {
    easConfig?: { projectId?: string };
  };
  const projectId =
    constants.easConfig?.projectId ??
    (typeof constants.expoConfig?.extra?.eas === "object" && constants.expoConfig.extra.eas !== null
      ? (constants.expoConfig.extra.eas as { projectId?: string }).projectId
      : undefined);

  return projectId ? { projectId } : undefined;
}

function shouldNotifyForCompletedTurn(
  state: CodexCompletionSummary,
  previous: CompletionSnapshot | undefined
) {
  return Boolean(
    state.isComplete &&
    state.latestTurnId &&
    previous &&
    (!previous.isComplete || previous.latestTurnId !== state.latestTurnId)
  );
}

function snapshotCompletion(state: CodexCompletionSummary): CompletionSnapshot {
  return {
    isComplete: state.isComplete,
    latestTurnCompletedAt: state.latestTurnCompletedAt,
    latestTurnId: state.latestTurnId,
    updatedAt: state.updatedAt
  };
}

function completionKey(state: CodexCompletionSummary) {
  return [
    state.conversationId,
    state.latestTurnId ?? "unknown",
    state.latestTurnCompletedAt ?? state.updatedAt
  ].join(":");
}

async function sendForegroundThreadDoneNotification(state: CodexCompletionSummary) {
  if (!(await ensureNotificationPermission())) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      body: state.prompt.trim() || "Untitled Codex thread",
      data: {
        conversationId: state.conversationId,
        projectId: state.projectId,
        source: state.source,
        turnId: state.latestTurnId ?? "unknown"
      },
      title: `Codex thread ${state.failed ? "failed" : "done"}`
    },
    trigger: null
  });
}

async function ensureNotificationPermission() {
  notificationPermissionPromise ??= (async () => {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      return true;
    }

    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  })();

  try {
    return await notificationPermissionPromise;
  } catch {
    notificationPermissionPromise = null;
    return false;
  }
}
