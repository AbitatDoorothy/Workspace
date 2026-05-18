import * as FileSystem from "expo-file-system/legacy";

import type { ConversationMessage, PairingState } from "../types";

export const MESSAGE_CACHE_MAX_MESSAGES = 1000;
export const MESSAGE_CACHE_MAX_BYTES = 2 * 1024 * 1024;

const MESSAGE_CACHE_DIRECTORY = "message-cache";
const MESSAGE_CACHE_VERSION = 1;
const MESSAGE_CACHE_INDEX_VERSION = 1;

interface CachedConversationMessages {
  messages: ConversationMessage[];
  version: typeof MESSAGE_CACHE_VERSION;
}

interface CachedConversationMessageIndex {
  entries: MessageCacheIndexEntry[];
  version: typeof MESSAGE_CACHE_INDEX_VERSION;
}

export interface MessageCacheIndexEntry {
  conversationId: string;
  lastReadAt?: string;
  lastReadSequence?: number;
  latestSequence: number;
  lastSyncedAt: string;
  projectId?: string;
  prompt?: string;
  status?: string;
  updatedAt?: string;
  workspaceId?: string;
}

export function messageCacheScopeFromPairing(pairing: PairingState | null) {
  if (!pairing) {
    return "unpaired";
  }

  const hostId = pairing.macId ?? pairing.hostMachineId ?? pairing.machineId;
  return safeCachePathPart(`${pairing.workspaceId}:${hostId}`);
}

export async function loadCachedConversationMessages(
  scope: string,
  conversationId: string
): Promise<ConversationMessage[]> {
  const path = await conversationCachePath(scope, conversationId);
  if (!path) {
    return [];
  }

  try {
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw) as Partial<CachedConversationMessages>;

    if (parsed.version !== MESSAGE_CACHE_VERSION || !Array.isArray(parsed.messages)) {
      return [];
    }

    return prepareMessagesForCache(parsed.messages);
  } catch {
    return [];
  }
}

export async function saveCachedConversationMessages(
  scope: string,
  conversationId: string,
  messages: ConversationMessage[],
  metadata: Partial<
    Pick<MessageCacheIndexEntry, "projectId" | "prompt" | "status" | "updatedAt" | "workspaceId">
  > = {}
) {
  const path = await conversationCachePath(scope, conversationId);
  if (!path) {
    return;
  }

  await ensureMessageCacheDirectory();
  const preparedMessages = prepareMessagesForCache(messages);
  const body: CachedConversationMessages = {
    version: MESSAGE_CACHE_VERSION,
    messages: preparedMessages
  };

  await FileSystem.writeAsStringAsync(path, JSON.stringify(body));
  await upsertMessageCacheIndexEntry(scope, {
    conversationId,
    latestSequence: highestCachedMessageSequence(preparedMessages),
    lastSyncedAt: new Date().toISOString(),
    ...metadata
  });
}

export async function moveCachedConversationMessages(
  scope: string,
  fromConversationId: string,
  toConversationId: string
) {
  if (fromConversationId === toConversationId) {
    return;
  }

  const sourceMessages = await loadCachedConversationMessages(scope, fromConversationId);
  if (sourceMessages.length > 0) {
    const targetMessages = await loadCachedConversationMessages(scope, toConversationId);
    await saveCachedConversationMessages(
      scope,
      toConversationId,
      mergeCachedMessages([
        ...targetMessages,
        ...sourceMessages.map((message) => ({ ...message, conversationId: toConversationId }))
      ])
    );
  }

  const sourcePath = await conversationCachePath(scope, fromConversationId);
  if (sourcePath) {
    await FileSystem.deleteAsync(sourcePath, { idempotent: true });
  }
  await removeMessageCacheIndexEntry(scope, fromConversationId);
}

export async function clearCachedConversationMessages() {
  const directory = messageCacheDirectory();
  if (!directory) {
    return;
  }

  await FileSystem.deleteAsync(directory, { idempotent: true });
}

export function prepareMessagesForCache(messages: ConversationMessage[]) {
  let prepared = mergeCachedMessages(messages).slice(-MESSAGE_CACHE_MAX_MESSAGES);

  while (
    prepared.length > 1 &&
    serializedMessageCacheByteLength(prepared) > MESSAGE_CACHE_MAX_BYTES
  ) {
    prepared = prepared.slice(Math.max(1, Math.ceil(prepared.length * 0.1)));
  }

  return prepared;
}

export function highestCachedMessageSequence(messages: ConversationMessage[]) {
  return messages.reduce((highest, message) => Math.max(highest, message.sequence), 0);
}

export async function loadMessageCacheIndex(scope: string): Promise<MessageCacheIndexEntry[]> {
  const path = await messageCacheIndexPath(scope);
  if (!path) {
    return [];
  }

  try {
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw) as Partial<CachedConversationMessageIndex>;

    if (parsed.version !== MESSAGE_CACHE_INDEX_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }

    return prepareMessageCacheIndexEntries(parsed.entries);
  } catch {
    return [];
  }
}

export async function upsertMessageCacheIndexEntry(scope: string, entry: MessageCacheIndexEntry) {
  const entries = await loadMessageCacheIndex(scope);
  const existing = entries.find((candidate) => candidate.conversationId === entry.conversationId);
  const nextEntries = prepareMessageCacheIndexEntries([
    ...entries.filter((candidate) => candidate.conversationId !== entry.conversationId),
    { ...existing, ...entry }
  ]);
  await saveMessageCacheIndex(scope, nextEntries);
}

export async function markCachedConversationRead(
  scope: string,
  conversationId: string,
  latestSequence: number
) {
  const entries = await loadMessageCacheIndex(scope);
  const existing = entries.find((candidate) => candidate.conversationId === conversationId);
  const nextReadSequence = Math.max(
    0,
    Math.floor(latestSequence),
    existing?.lastReadSequence ?? 0
  );

  await upsertMessageCacheIndexEntry(scope, {
    conversationId,
    lastReadAt: new Date().toISOString(),
    lastReadSequence: nextReadSequence,
    lastSyncedAt: existing?.lastSyncedAt ?? new Date().toISOString(),
    latestSequence: Math.max(existing?.latestSequence ?? 0, nextReadSequence),
    ...(existing?.projectId ? { projectId: existing.projectId } : {}),
    ...(existing?.prompt ? { prompt: existing.prompt } : {}),
    ...(existing?.status ? { status: existing.status } : {}),
    ...(existing?.updatedAt ? { updatedAt: existing.updatedAt } : {}),
    ...(existing?.workspaceId ? { workspaceId: existing.workspaceId } : {})
  });
}

async function saveMessageCacheIndex(scope: string, entries: MessageCacheIndexEntry[]) {
  const path = await messageCacheIndexPath(scope);
  if (!path) {
    return;
  }

  await ensureMessageCacheDirectory();
  const body: CachedConversationMessageIndex = {
    entries: prepareMessageCacheIndexEntries(entries),
    version: MESSAGE_CACHE_INDEX_VERSION
  };
  await FileSystem.writeAsStringAsync(path, JSON.stringify(body));
}

async function removeMessageCacheIndexEntry(scope: string, conversationId: string) {
  const entries = await loadMessageCacheIndex(scope);
  await saveMessageCacheIndex(
    scope,
    entries.filter((entry) => entry.conversationId !== conversationId)
  );
}

async function conversationCachePath(scope: string, conversationId: string) {
  const directory = messageCacheDirectory();
  if (!directory) {
    return null;
  }

  return `${directory}${safeCachePathPart(scope)}--${safeCachePathPart(conversationId)}.json`;
}

async function messageCacheIndexPath(scope: string) {
  const directory = messageCacheDirectory();
  if (!directory) {
    return null;
  }

  return `${directory}${safeCachePathPart(scope)}--index.json`;
}

function messageCacheDirectory() {
  return FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}${MESSAGE_CACHE_DIRECTORY}/`
    : null;
}

async function ensureMessageCacheDirectory() {
  const directory = messageCacheDirectory();
  if (!directory) {
    return;
  }

  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
}

function mergeCachedMessages(messages: ConversationMessage[]) {
  const byId = new Map<string, ConversationMessage>();

  for (const message of messages) {
    if (isCacheableMessage(message)) {
      byId.set(message.id, message);
    }
  }

  return [...byId.values()].sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function prepareMessageCacheIndexEntries(entries: MessageCacheIndexEntry[]) {
  const byConversationId = new Map<string, MessageCacheIndexEntry>();

  for (const entry of entries) {
    if (!isCacheableIndexEntry(entry)) {
      continue;
    }

    byConversationId.set(entry.conversationId, {
      conversationId: entry.conversationId,
      ...(entry.lastReadAt ? { lastReadAt: entry.lastReadAt } : {}),
      ...(Number.isFinite(entry.lastReadSequence)
        ? { lastReadSequence: Math.max(0, Math.floor(entry.lastReadSequence ?? 0)) }
        : {}),
      latestSequence: Math.max(0, Math.floor(entry.latestSequence)),
      lastSyncedAt: entry.lastSyncedAt,
      ...(entry.projectId ? { projectId: entry.projectId } : {}),
      ...(entry.prompt ? { prompt: entry.prompt } : {}),
      ...(entry.status ? { status: entry.status } : {}),
      ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
      ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {})
    });
  }

  return [...byConversationId.values()].sort((left, right) =>
    right.lastSyncedAt.localeCompare(left.lastSyncedAt)
  );
}

function isCacheableIndexEntry(entry: MessageCacheIndexEntry) {
  return (
    typeof entry.conversationId === "string" &&
    entry.conversationId.trim().length > 0 &&
    Number.isFinite(entry.latestSequence) &&
    typeof entry.lastSyncedAt === "string" &&
    entry.lastSyncedAt.trim().length > 0
  );
}

function isCacheableMessage(message: ConversationMessage) {
  return (
    typeof message.id === "string" &&
    typeof message.conversationId === "string" &&
    Number.isFinite(message.sequence) &&
    typeof message.content === "string" &&
    typeof message.createdAt === "string"
  );
}

function serializedMessageCacheByteLength(messages: ConversationMessage[]) {
  return utf8ByteLength(JSON.stringify({ version: MESSAGE_CACHE_VERSION, messages }));
}

function utf8ByteLength(value: string) {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);

    if (codePoint < 0x80) {
      bytes += 1;
    } else if (codePoint < 0x800) {
      bytes += 2;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

function safeCachePathPart(value: string) {
  return encodeURIComponent(value.trim() || "unknown");
}
