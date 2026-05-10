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
  heartbeatIntervalMs?: number;
  heartbeatStaleMs?: number;
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

interface RelayHeartbeatControllerInput {
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
  heartbeatIntervalMs?: number;
  now?: () => number;
  onStale?: () => void;
  setIntervalFn?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  socket: Pick<WebSocket, "close" | "readyState" | "send"> & Partial<Pick<WebSocket, "terminate">>;
  staleAfterMs?: number;
}

const RELAY_HEARTBEAT_INTERVAL_MS = 15_000;
const RELAY_HEARTBEAT_STALE_MS = 45_000;

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
  let heartbeat: ReturnType<typeof createRelayHeartbeatController> | null = null;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) {
      return;
    }

    const url = relayWebSocketUrl(input.relayEndpoint, input.relayId);
    const activeSocket = new WebSocket(url);
    socket = activeSocket;
    activeSocket.on("open", () => {
      if (socket !== activeSocket || stopped) {
        return;
      }

      heartbeat?.stop();
      heartbeat = createRelayHeartbeatController({
        heartbeatIntervalMs: input.heartbeatIntervalMs,
        onStale: () => {
          if (socket === activeSocket) {
            scheduleReconnect();
          }
        },
        socket: activeSocket,
        staleAfterMs: input.heartbeatStaleMs
      });
      heartbeat.start();
    });
    activeSocket.on("message", (data) => {
      if (socket !== activeSocket) {
        return;
      }

      if (isRelayHeartbeatAck(String(data)) || isRelayConnected(String(data))) {
        heartbeat?.handleHeartbeatAck();
        return;
      }

      void handleRelaySocketMessage(String(data), {
        fetch: input.fetch,
        localEndpoint: input.localEndpoint,
        relayId: input.relayId,
        replayCache,
        socket: activeSocket,
        store: input.store
      });
    });
    activeSocket.on("close", () => {
      if (socket !== activeSocket) {
        return;
      }

      heartbeat?.stop();
      heartbeat = null;
      socket = null;
      scheduleReconnect();
    });
    activeSocket.on("error", () => {
      activeSocket.close();
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
      heartbeat?.stop();
      heartbeat = null;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    }
  };
}

export function createRelayHeartbeatController(input: RelayHeartbeatControllerInput) {
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? RELAY_HEARTBEAT_INTERVAL_MS;
  const staleAfterMs = input.staleAfterMs ?? RELAY_HEARTBEAT_STALE_MS;
  const now = input.now ?? Date.now;
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  let lastHeartbeatAckAt = now();
  let timer: ReturnType<typeof setInterval> | null = null;

  function tick() {
    if (input.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (now() - lastHeartbeatAckAt > staleAfterMs) {
      stop();
      if (typeof input.socket.terminate === "function") {
        input.socket.terminate();
      } else {
        input.socket.close(1011, "Relay heartbeat timed out");
      }
      input.onStale?.();
      return;
    }

    input.socket.send(
      JSON.stringify({
        sentAt: new Date(now()).toISOString(),
        type: "heartbeat"
      })
    );
  }

  return {
    handleHeartbeatAck() {
      lastHeartbeatAckAt = now();
    },
    start() {
      if (timer) {
        return;
      }
      timer = setIntervalFn(tick, heartbeatIntervalMs);
      timer.unref?.();
    },
    stop
  };

  function stop() {
    if (!timer) {
      return;
    }
    clearIntervalFn(timer);
    timer = null;
  }
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

function isRelayConnected(raw: string) {
  return relayMessageType(raw) === "connected";
}

function isRelayHeartbeatAck(raw: string) {
  return relayMessageType(raw) === "heartbeat_ack";
}

function relayMessageType(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    return typeof parsed.type === "string" ? parsed.type : "";
  } catch {
    return "";
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
