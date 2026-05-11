import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import type { ApiClient } from "../api/client";
import type { CodexCompletionSummary, ConversationMessage } from "../types";
import {
  highestCachedMessageSequence,
  loadCachedConversationMessages,
  loadMessageCacheIndex,
  saveCachedConversationMessages,
  upsertMessageCacheIndexEntry,
  type MessageCacheIndexEntry
} from "./message-cache";

export const PRELOAD_POLL_INTERVAL_MS = 3500;
export const MAX_PRELOAD_CONVERSATIONS_PER_TICK = 4;

interface UseMessagePreloaderInput {
  api: ApiClient;
  enabled: boolean;
  messageCacheScope: string;
}

const PRELOAD_ACTIVE_STATUSES = new Set(["awaiting_approval", "queued", "running"]);

export function useMessagePreloader({ api, enabled, messageCacheScope }: UseMessagePreloaderInput) {
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    async function preloadOnce() {
      if (cancelled || inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      try {
        await preloadChangedConversationMessages(api, messageCacheScope, () => cancelled);
      } catch (caught) {
        console.warn(`[message-preloader] ${errorMessage(caught)}`);
      } finally {
        inFlightRef.current = false;
      }
    }

    void preloadOnce();
    const timer = setInterval(preloadOnce, PRELOAD_POLL_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void preloadOnce();
      }
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [api, enabled, messageCacheScope]);
}

async function preloadChangedConversationMessages(
  api: ApiClient,
  messageCacheScope: string,
  isCancelled: () => boolean
) {
  const [completionStates, cacheIndex] = await Promise.all([
    api.listCompletionStates(),
    loadMessageCacheIndex(messageCacheScope)
  ]);
  const indexByConversationId = new Map(
    cacheIndex.map((entry) => [entry.conversationId, entry] as const)
  );
  const candidates = completionStates
    .filter((state) => isPreloadCandidate(state, indexByConversationId.get(state.conversationId)))
    .sort(comparePreloadCandidates)
    .slice(0, MAX_PRELOAD_CONVERSATIONS_PER_TICK);

  for (const state of candidates) {
    if (isCancelled()) {
      return;
    }

    await preloadConversationMessages(
      api,
      messageCacheScope,
      state,
      indexByConversationId.get(state.conversationId)
    );
  }
}

function isPreloadCandidate(
  state: CodexCompletionSummary,
  cacheEntry: MessageCacheIndexEntry | undefined
) {
  if (isActivePreloadStatus(state.status)) {
    return true;
  }

  if (!cacheEntry) {
    return false;
  }

  return (
    state.status !== cacheEntry.status ||
    safeTimestamp(state.updatedAt) > safeTimestamp(cacheEntry.updatedAt)
  );
}

async function preloadConversationMessages(
  api: ApiClient,
  messageCacheScope: string,
  state: CodexCompletionSummary,
  cacheEntry: MessageCacheIndexEntry | undefined
) {
  const cachedMessages = await loadCachedConversationMessages(
    messageCacheScope,
    state.conversationId
  );
  const latestSequence = Math.max(
    cacheEntry?.latestSequence ?? 0,
    highestCachedMessageSequence(cachedMessages)
  );

  if (latestSequence === 0 && !isActivePreloadStatus(state.status)) {
    await upsertMessageCacheIndexEntry(messageCacheScope, cacheIndexEntryFromState(state, 0));
    return;
  }

  const nextMessages = await api.listMessages(
    state.conversationId,
    latestSequence > 0 ? latestSequence : undefined,
    { includeRuntime: false }
  );
  const mergedMessages = mergePreloadedMessages(cachedMessages, nextMessages);

  if (mergedMessages.length > 0) {
    await saveCachedConversationMessages(messageCacheScope, state.conversationId, mergedMessages, {
      projectId: state.projectId,
      prompt: state.prompt,
      status: state.status,
      updatedAt: state.updatedAt,
      workspaceId: state.workspaceId
    });
    return;
  }

  await upsertMessageCacheIndexEntry(
    messageCacheScope,
    cacheIndexEntryFromState(state, latestSequence)
  );
}

function cacheIndexEntryFromState(
  state: CodexCompletionSummary,
  latestSequence: number
): MessageCacheIndexEntry {
  return {
    conversationId: state.conversationId,
    latestSequence,
    lastSyncedAt: new Date().toISOString(),
    projectId: state.projectId,
    prompt: state.prompt,
    status: state.status,
    updatedAt: state.updatedAt,
    workspaceId: state.workspaceId
  };
}

function mergePreloadedMessages(
  cachedMessages: ConversationMessage[],
  nextMessages: ConversationMessage[]
) {
  const byId = new Map<string, ConversationMessage>();
  for (const message of [...cachedMessages, ...nextMessages]) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function comparePreloadCandidates(left: CodexCompletionSummary, right: CodexCompletionSummary) {
  const leftActive = isActivePreloadStatus(left.status);
  const rightActive = isActivePreloadStatus(right.status);

  if (leftActive !== rightActive) {
    return leftActive ? -1 : 1;
  }

  return safeTimestamp(right.updatedAt) - safeTimestamp(left.updatedAt);
}

function isActivePreloadStatus(status: string) {
  return PRELOAD_ACTIVE_STATUSES.has(status);
}

function safeTimestamp(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
