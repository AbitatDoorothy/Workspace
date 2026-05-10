import WebSocket from "ws";

import {
  createRelayReplayCache,
  decryptRelayEnvelope,
  encryptRelayEnvelope,
  relaySessionKey,
  validateRelayEnvelopeFreshness,
  type RelayEncryptedEnvelope,
  type RelayPlainRequest
} from "@abitat_reece/shared";

import type { LocalControlStore } from "./state.js";

interface RelayKeyMaterial {
  id: string;
  keyMaterial: string;
  kind: "device" | "pairing";
}

interface RelayStore {
  getRelayKeyMaterials(relayId: string): Promise<RelayKeyMaterial[]>;
}

interface HandleRelayRequestInput {
  envelope: RelayEncryptedEnvelope;
  fetch?: typeof fetch;
  localEndpoint: string;
  relayId: string;
  replayCache: ReturnType<typeof createRelayReplayCache>;
  store: RelayStore;
}

interface StartRelayClientInput {
  fetch?: typeof fetch;
  localEndpoint: string;
  reconnectIntervalMs?: number;
  relayEndpoint: string;
  relayId: string;
  store: LocalControlStore;
}

interface RelayHostRequestMessage {
  envelope: RelayEncryptedEnvelope;
  requestId: string;
  type: "request";
}

interface RelayHostErrorMessage {
  error: string;
  requestId: string;
  status: number;
  type: "error";
}

export { createRelayReplayCache };

export async function handleRelayRequest(input: HandleRelayRequestInput) {
  const keyMaterials = await input.store.getRelayKeyMaterials(input.relayId);
  const replayCache = input.replayCache;

  for (const keyMaterial of keyMaterials) {
    const key = await relaySessionKey(keyMaterial.keyMaterial, input.relayId);
    const request = await decryptRelayEnvelope<RelayPlainRequest>(key, input.envelope).catch(
      () => null
    );
    if (!request) {
      continue;
    }

    validateRelayEnvelopeFreshness({ createdAt: input.envelope.createdAt });
    replayCache.assertFresh(request.requestId);
    const localResponse = await forwardToLocalApi({
      fetch: input.fetch ?? fetch,
      localEndpoint: input.localEndpoint,
      request
    });

    return encryptRelayEnvelope(key, {
      body: localResponse.body,
      headers: localResponse.headers,
      requestId: request.requestId,
      status: localResponse.status
    });
  }

  throw new Error("Relay request could not be decrypted by this Mac");
}

export function startRelayClient(input: StartRelayClientInput) {
  const replayCache = createRelayReplayCache();
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) {
      return;
    }

    const url = relayWebSocketUrl(input.relayEndpoint, input.relayId);
    socket = new WebSocket(url);
    socket.on("message", (data) => {
      void handleRelaySocketMessage(String(data), {
        fetch: input.fetch,
        localEndpoint: input.localEndpoint,
        relayId: input.relayId,
        replayCache,
        socket,
        store: input.store
      });
    });
    socket.on("close", () => scheduleReconnect());
    socket.on("error", () => {
      socket?.close();
    });
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, input.reconnectIntervalMs ?? 2_000);
    reconnectTimer.unref?.();
  };

  connect();

  return {
    close() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    }
  };
}

export async function handleRelaySocketMessage(
  raw: string,
  input: Omit<HandleRelayRequestInput, "envelope"> & { socket: WebSocket | null }
) {
  const message = parseRelayHostRequest(raw);
  if (!message) {
    return;
  }

  const send = (
    payload:
      | RelayHostErrorMessage
      | { envelope: RelayEncryptedEnvelope; requestId: string; type: "response" }
  ) => {
    if (input.socket?.readyState === WebSocket.OPEN) {
      input.socket.send(JSON.stringify(payload));
    }
  };

  let envelope: RelayEncryptedEnvelope;
  try {
    envelope = await handleRelayRequest({ ...input, envelope: message.envelope });
  } catch (error) {
    send({
      error: errorMessage(error),
      requestId: message.requestId,
      status: statusCode(error),
      type: "error"
    });
    return;
  }

  send({
    envelope,
    requestId: message.requestId,
    type: "response"
  });
}

async function forwardToLocalApi(input: {
  fetch: typeof fetch;
  localEndpoint: string;
  request: RelayPlainRequest;
}) {
  const response = await input.fetch(new URL(input.request.path, input.localEndpoint), {
    body: input.request.body === undefined ? undefined : JSON.stringify(input.request.body),
    headers: input.request.headers,
    method: input.request.method
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") && text ? JSON.parse(text) : text;

  return {
    body,
    headers: {
      "content-type": contentType
    },
    status: response.status
  };
}

function parseRelayHostRequest(raw: string): RelayHostRequestMessage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RelayHostRequestMessage>;
    if (
      parsed.type !== "request" ||
      typeof parsed.requestId !== "string" ||
      !parsed.envelope ||
      parsed.envelope.requestId !== parsed.requestId
    ) {
      return null;
    }

    return parsed as RelayHostRequestMessage;
  } catch {
    return null;
  }
}

function relayWebSocketUrl(relayEndpoint: string, relayId: string) {
  const url = new URL(`/relay/${encodeURIComponent(relayId)}/host`, relayEndpoint);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  return url.toString();
}

function statusCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }

  const message = errorMessage(error);
  if (message.includes("could not be decrypted")) {
    return 401;
  }
  if (message.includes("already been processed")) {
    return 409;
  }
  if (message.includes("timestamp") || message.includes("too old")) {
    return 400;
  }
  return 500;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
