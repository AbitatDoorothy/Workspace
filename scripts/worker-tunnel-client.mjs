#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import WebSocket from "ws";

const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 2_000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

loadEnvFile(".env.local");

const publicUrl = trimTrailingSlash(process.env.ABITAT_PUBLIC_URL ?? "https://workspace.abitat.io");
const localOrigin = trimTrailingSlash(process.env.ABITAT_LOCAL_ORIGIN ?? "http://127.0.0.1:3000");
const connectorToken = process.env.ABITAT_EDGE_TUNNEL_TOKEN ?? process.env.CLOUDFLARE_TUNNEL_TOKEN;

if (!connectorToken) {
  console.error("Missing ABITAT_EDGE_TUNNEL_TOKEN or CLOUDFLARE_TUNNEL_TOKEN in .env.local");
  process.exit(1);
}

let stopped = false;
let websocket = null;
let heartbeat = null;
const activeRequests = new Map();
const activeWebSockets = new Map();

connect();

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function connect() {
  const endpoint = new URL("/__abitat_tunnel/connect", publicUrl);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  endpoint.searchParams.set("token", connectorToken);

  websocket = new WebSocket(endpoint);
  websocket.addEventListener("open", () => {
    console.log(`worker-tunnel=connected ${publicUrl} -> ${localOrigin}`);
    heartbeat = setInterval(() => {
      send({ type: "pong", at: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  });
  websocket.addEventListener("message", (event) => {
    handleMessage(event.data).catch((error) => {
      console.error(
        `worker-tunnel=message-error ${error instanceof Error ? error.message : "unknown"}`
      );
    });
  });
  websocket.addEventListener("close", () => {
    clearInterval(heartbeat);
    heartbeat = null;
    abortActiveRequests();
    if (!stopped) {
      console.error(`worker-tunnel=reconnecting-in ${RECONNECT_DELAY_MS}ms`);
      setTimeout(connect, RECONNECT_DELAY_MS);
    }
  });
  websocket.addEventListener("error", () => {
    console.error("worker-tunnel=connection-error");
  });
}

async function handleMessage(raw) {
  const message = JSON.parse(await eventDataToString(raw));

  if (message.type === "connected") {
    return;
  }

  if (message.type === "cancel") {
    activeRequests.get(message.id)?.abort();
    return;
  }

  if (message.type === "websocket_open") {
    openLocalWebSocket(message);
    return;
  }

  if (message.type === "websocket_message") {
    const ws = activeWebSockets.get(message.id);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(deserializeWebSocketData(message));
    }
    return;
  }

  if (message.type === "websocket_close") {
    const ws = activeWebSockets.get(message.id);
    activeWebSockets.delete(message.id);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.close(message.code ?? 1000, message.reason ?? "Closed by remote");
    }
    return;
  }

  if (message.type !== "request") {
    return;
  }

  const abortController = new AbortController();
  activeRequests.set(message.id, abortController);

  try {
    const response = await fetch(new URL(message.path, localOrigin), {
      method: message.method,
      headers: buildRequestHeaders(message.headers ?? []),
      body: requestBody(message),
      redirect: "manual",
      signal: abortController.signal
    });

    send({
      type: "response_start",
      id: message.id,
      status: response.status,
      headers: serializeResponseHeaders(response.headers)
    });

    if (!response.body) {
      send({ type: "response_body", id: message.id, done: true });
      return;
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        send({ type: "response_body", id: message.id, done: true });
        return;
      }
      send({
        type: "response_body",
        id: message.id,
        body: Buffer.from(value).toString("base64")
      });
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }
    send({
      type: "response_error",
      id: message.id,
      error: error instanceof Error ? error.message : "Request failed"
    });
  } finally {
    activeRequests.delete(message.id);
  }
}

function openLocalWebSocket(message) {
  const target = new URL(message.path, localOrigin);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";

  const ws = new WebSocket(target, {
    headers: Object.fromEntries(buildRequestHeaders(message.headers ?? []))
  });
  activeWebSockets.set(message.id, ws);

  ws.addEventListener("open", () => {
    send({ type: "websocket_opened", id: message.id });
  });
  ws.addEventListener("message", (event) => {
    send({
      type: "websocket_message",
      id: message.id,
      ...serializeWebSocketData(event.data)
    });
  });
  ws.addEventListener("close", (event) => {
    activeWebSockets.delete(message.id);
    send({
      type: "websocket_close",
      id: message.id,
      code: event.code,
      reason: event.reason
    });
  });
  ws.addEventListener("error", () => {
    activeWebSockets.delete(message.id);
    send({ type: "websocket_error", id: message.id, error: "Local WebSocket failed" });
  });
}

function buildRequestHeaders(entries) {
  const headers = new Headers();
  const publicOrigin = new URL(publicUrl);

  for (const [name, value] of entries) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      headers.append(name, value);
    }
  }

  headers.set("x-forwarded-host", publicOrigin.host);
  headers.set("x-forwarded-proto", publicOrigin.protocol.replace(/:$/u, ""));
  headers.set("x-forwarded-port", publicOrigin.protocol === "https:" ? "443" : "80");
  headers.set("x-abitat-public-url", publicUrl);

  return headers;
}

function serializeResponseHeaders(headers) {
  const entries = [];
  const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];

  headers.forEach((value, name) => {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      return;
    }
    if (name.toLowerCase() === "set-cookie" && setCookies.length > 0) {
      return;
    }
    entries.push([name, value]);
  });

  for (const cookie of setCookies) {
    entries.push(["set-cookie", cookie]);
  }

  return entries;
}

function requestBody(message) {
  if (!message.body || message.method === "GET" || message.method === "HEAD") {
    return undefined;
  }
  return Buffer.from(message.body, "base64");
}

function serializeWebSocketData(data) {
  if (typeof data === "string") {
    return { text: data };
  }

  if (data instanceof ArrayBuffer) {
    return { body: Buffer.from(data).toString("base64") };
  }

  if (ArrayBuffer.isView(data)) {
    return { body: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64") };
  }

  return { text: String(data) };
}

function deserializeWebSocketData(message) {
  if (typeof message.text === "string") {
    return message.text;
  }

  return Buffer.from(message.body ?? "", "base64");
}

function send(message) {
  if (websocket?.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify(message));
  }
}

async function eventDataToString(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (typeof data?.text === "function") {
    return data.text();
  }
  return String(data);
}

function abortActiveRequests() {
  for (const abortController of activeRequests.values()) {
    abortController.abort();
  }
  activeRequests.clear();

  for (const websocket of activeWebSockets.values()) {
    websocket.close(1011, "Connector stopped");
  }
  activeWebSockets.clear();
}

function loadEnvFile(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    return;
  }

  for (const line of readFileSync(absolute, "utf8").split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/u, "");
}

function stop() {
  stopped = true;
  clearInterval(heartbeat);
  abortActiveRequests();
  websocket?.close(1000, "Stopped");
  process.exit(0);
}
