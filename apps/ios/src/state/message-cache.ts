import * as FileSystem from "expo-file-system/legacy";

import type { ConversationMessage, PairingState } from "../types";

export const MESSAGE_CACHE_MAX_MESSAGES = 1000;
export const MESSAGE_CACHE_MAX_BYTES = 2 * 1024 * 1024;

const MESSAGE_CACHE_DIRECTORY = "message-cache";
const MESSAGE_CACHE_VERSION = 1;

interface CachedConversationMessages {
  messages: ConversationMessage[];
  version: typeof MESSAGE_CACHE_VERSION;
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
  messages: ConversationMessage[]
) {
  const path = await conversationCachePath(scope, conversationId);
  if (!path) {
    return;
  }

  await ensureMessageCacheDirectory();
  const body: CachedConversationMessages = {
    version: MESSAGE_CACHE_VERSION,
    messages: prepareMessagesForCache(messages)
  };

  await FileSystem.writeAsStringAsync(path, JSON.stringify(body));
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

async function conversationCachePath(scope: string, conversationId: string) {
  const directory = messageCacheDirectory();
  if (!directory) {
    return null;
  }

  return `${directory}${safeCachePathPart(scope)}--${safeCachePathPart(conversationId)}.json`;
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
