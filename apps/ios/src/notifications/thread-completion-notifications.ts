import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";

import type { ApiClient } from "../api/client";
import type { ConversationMessage, ConversationSummary } from "../types";

const POLL_INTERVAL_MS = 5000;
const IN_PROGRESS_STATUSES = new Set([
  "awaiting_approval",
  "committing",
  "preparing",
  "queued",
  "running"
]);
const COMPLETED_STATUSES = new Set(["approved", "cancelled", "failed", "pushed"]);
const rememberedRunningConversationIds = new Set<string>();
let notificationPermissionPromise: Promise<boolean> | null = null;

interface ConversationSnapshot {
  latestMessageId: string | null;
  status: string;
  updatedAt: string | null;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export function rememberRunningConversation(conversationId: string) {
  rememberedRunningConversationIds.add(conversationId);
}

export function useThreadCompletionNotifications(api: ApiClient, isEnabled: boolean) {
  const runningConversationIdsRef = useRef(new Set<string>());
  const conversationSnapshotsRef = useRef(new Map<string, ConversationSnapshot>());
  const hasBootstrappedRef = useRef(false);
  const isPollingRef = useRef(false);
  const watchStartedAtMsRef = useRef(0);

  useEffect(() => {
    if (!isEnabled) {
      hasBootstrappedRef.current = false;
      runningConversationIdsRef.current.clear();
      conversationSnapshotsRef.current.clear();
      watchStartedAtMsRef.current = 0;
      return;
    }

    let cancelled = false;
    watchStartedAtMsRef.current = Date.now();

    async function poll() {
      if (cancelled || isPollingRef.current) {
        return;
      }

      isPollingRef.current = true;
      try {
        await ensureNotificationPermission();
        const conversations = await listNotificationConversations(api);

        for (const conversationId of rememberedRunningConversationIds) {
          runningConversationIdsRef.current.add(conversationId);
        }

        if (!hasBootstrappedRef.current) {
          const snapshots = await Promise.all(
            conversations.map(async (conversation) => {
              if (isConversationInProgress(conversation.status)) {
                runningConversationIdsRef.current.add(conversation.id);
              }

              return [
                conversation.id,
                await snapshotNotificationConversation(api, conversation)
              ] as const;
            })
          );

          for (const [conversationId, snapshot] of snapshots) {
            conversationSnapshotsRef.current.set(conversationId, snapshot);
          }
          hasBootstrappedRef.current = true;
        }

        const visibleConversationIds = new Set(
          conversations.map((conversation) => conversation.id)
        );
        for (const conversation of conversations) {
          const previousSnapshot = conversationSnapshotsRef.current.get(conversation.id);

          if (!previousSnapshot && isConversationInProgress(conversation.status)) {
            runningConversationIdsRef.current.add(conversation.id);
            conversationSnapshotsRef.current.set(
              conversation.id,
              snapshotConversation(conversation)
            );
            continue;
          }

          if (isConversationInProgress(conversation.status)) {
            runningConversationIdsRef.current.add(conversation.id);
            conversationSnapshotsRef.current.set(
              conversation.id,
              snapshotConversation(conversation)
            );
            continue;
          }

          if (
            isConversationDone(conversation.status) &&
            runningConversationIdsRef.current.has(conversation.id)
          ) {
            runningConversationIdsRef.current.delete(conversation.id);
            rememberedRunningConversationIds.delete(conversation.id);
            await sendThreadDoneNotification(conversation);
            conversationSnapshotsRef.current.set(
              conversation.id,
              await snapshotConversationWithLatestMessage(api, conversation)
            );
            continue;
          }

          if (
            isConversationDone(conversation.status) &&
            conversation.source === "codex_app" &&
            previousSnapshot &&
            hasConversationAdvanced(previousSnapshot, conversation)
          ) {
            const latestMessage = await latestNotificationMessage(api, conversation);
            conversationSnapshotsRef.current.set(
              conversation.id,
              snapshotConversation(conversation, latestMessage?.id ?? null)
            );

            if (shouldNotifyForCompletedCodexTurn(conversation, latestMessage, previousSnapshot)) {
              await sendThreadDoneNotification(conversation);
            }
            continue;
          }

          if (
            isConversationDone(conversation.status) &&
            conversation.source === "codex_app" &&
            !previousSnapshot
          ) {
            const latestMessage = await latestNotificationMessage(api, conversation);
            conversationSnapshotsRef.current.set(
              conversation.id,
              snapshotConversation(conversation, latestMessage?.id ?? null)
            );

            if (
              shouldNotifyForNewCompletedCodexConversation(
                conversation,
                latestMessage,
                watchStartedAtMsRef.current
              )
            ) {
              await sendThreadDoneNotification(conversation);
            }
            continue;
          }

          conversationSnapshotsRef.current.set(
            conversation.id,
            snapshotConversation(conversation, previousSnapshot?.latestMessageId ?? null)
          );
        }

        for (const conversationId of runningConversationIdsRef.current) {
          if (!visibleConversationIds.has(conversationId)) {
            runningConversationIdsRef.current.delete(conversationId);
            rememberedRunningConversationIds.delete(conversationId);
          }
        }
        for (const conversationId of conversationSnapshotsRef.current.keys()) {
          if (!visibleConversationIds.has(conversationId)) {
            conversationSnapshotsRef.current.delete(conversationId);
          }
        }
      } catch {
        // Polling is best-effort; the next interval will retry without interrupting chat.
      } finally {
        isPollingRef.current = false;
      }
    }

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api, isEnabled]);
}

async function listNotificationConversations(api: ApiClient) {
  const projects = await api.listProjects();
  const conversationLists = await Promise.allSettled(
    projects.map((project) => api.listConversations(project.id))
  );

  return conversationLists.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function snapshotNotificationConversation(api: ApiClient, conversation: ConversationSummary) {
  if (conversation.source === "codex_app" && isConversationDone(conversation.status)) {
    return snapshotConversationWithLatestMessage(api, conversation);
  }

  return snapshotConversation(conversation);
}

async function snapshotConversationWithLatestMessage(
  api: ApiClient,
  conversation: ConversationSummary
) {
  const latestMessage =
    conversation.source === "codex_app" ? await latestNotificationMessage(api, conversation) : null;
  return snapshotConversation(conversation, latestMessage?.id ?? null);
}

function snapshotConversation(
  conversation: ConversationSummary,
  latestMessageId: string | null = null
): ConversationSnapshot {
  return {
    latestMessageId,
    status: conversation.status,
    updatedAt: conversation.updatedAt ?? null
  };
}

function hasConversationAdvanced(
  previousSnapshot: ConversationSnapshot,
  conversation: ConversationSummary
) {
  const nextUpdatedAt = conversation.updatedAt ?? null;
  return Boolean(nextUpdatedAt && nextUpdatedAt !== previousSnapshot.updatedAt);
}

async function latestNotificationMessage(api: ApiClient, conversation: ConversationSummary) {
  const messages = await api.listMessages(conversation.id);
  return messages.at(-1) ?? null;
}

function isNotificationMessageFromCompletedTurn(message: ConversationMessage) {
  return message.role === "assistant" || message.role === "runtime";
}

function shouldNotifyForCompletedCodexTurn(
  conversation: ConversationSummary,
  latestMessage: ConversationMessage | null,
  previousSnapshot: ConversationSnapshot
) {
  if (conversation.status === "failed" && previousSnapshot.status !== "failed") {
    return true;
  }

  return Boolean(
    latestMessage &&
    latestMessage.id !== previousSnapshot.latestMessageId &&
    isNotificationMessageFromCompletedTurn(latestMessage)
  );
}

function shouldNotifyForNewCompletedCodexConversation(
  conversation: ConversationSummary,
  latestMessage: ConversationMessage | null,
  watchStartedAtMs: number
) {
  if (conversation.status === "failed") {
    return wasConversationUpdatedAfter(conversation, watchStartedAtMs);
  }

  return Boolean(
    latestMessage &&
    isNotificationMessageFromCompletedTurn(latestMessage) &&
    wasMessageCreatedAfter(latestMessage, watchStartedAtMs)
  );
}

function wasConversationUpdatedAfter(conversation: ConversationSummary, timestampMs: number) {
  const updatedAtMs = conversation.updatedAt ? Date.parse(conversation.updatedAt) : 0;
  return Number.isFinite(updatedAtMs) && updatedAtMs > timestampMs;
}

function wasMessageCreatedAfter(message: ConversationMessage, timestampMs: number) {
  const messageCreatedAtMs = Date.parse(message.createdAt);

  return Number.isFinite(messageCreatedAtMs) && messageCreatedAtMs > timestampMs;
}

async function sendThreadDoneNotification(conversation: ConversationSummary) {
  if (!(await ensureNotificationPermission())) {
    return;
  }

  const failed = conversation.status === "failed";
  const isCodexThread = conversation.source === "codex_app";
  const title = `${isCodexThread ? "Codex thread" : "Thread"} ${failed ? "failed" : "done"}`;
  const body = conversation.prompt.trim() || "Untitled conversation";

  await Notifications.scheduleNotificationAsync({
    content: {
      body,
      data: {
        conversationId: conversation.id,
        projectId: conversation.projectId,
        source: conversation.source ?? "abitat"
      },
      title
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

function isConversationInProgress(status: string) {
  return IN_PROGRESS_STATUSES.has(status);
}

function isConversationDone(status: string) {
  return COMPLETED_STATUSES.has(status);
}
