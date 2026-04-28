const CONNECT_PATH = "/__abitat_tunnel/connect";
const STATUS_PATH = "/__abitat_tunnel/status";
const RESPONSE_START_TIMEOUT_MS = 30_000;

export class TunnelSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connector = null;
    this.pending = new Map();
    this.websockets = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === CONNECT_PATH) {
      return this.connect(request);
    }

    if (url.pathname === STATUS_PATH) {
      return json({ connected: this.isConnected(), pending: this.pending.size });
    }

    return this.proxy(request);
  }

  async connect(request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? bearerToken(request);
    if (!(await verifyToken(token, this.env.CONNECTOR_TOKEN_SHA256))) {
      return new Response("Forbidden", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    if (this.connector && this.connector.readyState === 1) {
      this.connector.close(1012, "Connector replaced");
    }

    this.connector = server;
    server.addEventListener("message", (event) => {
      this.handleConnectorMessage(event.data);
    });
    server.addEventListener("close", () => {
      if (this.connector === server) {
        this.connector = null;
      }
      this.failPending("Local connector disconnected");
    });
    server.addEventListener("error", () => {
      if (this.connector === server) {
        this.connector = null;
      }
      this.failPending("Local connector errored");
    });

    server.send(JSON.stringify({ type: "connected" }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async proxy(request) {
    if (!this.isConnected()) {
      return new Response("Local workspace connector is offline. Run pnpm cloud:dev.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }

    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return this.proxyWebSocket(request);
    }

    const id = crypto.randomUUID();
    const url = new URL(request.url);
    let controller;
    const stream = new ReadableStream({
      start(nextController) {
        controller = nextController;
      },
      cancel: () => {
        this.pending.delete(id);
        this.sendConnector({ type: "cancel", id });
      }
    });

    const response = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve(new Response("Local workspace connector timed out.", { status: 504 }));
      }, RESPONSE_START_TIMEOUT_MS);

      this.pending.set(id, {
        controller,
        resolve,
        started: false,
        stream,
        timeout
      });
    });

    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : arrayBufferToBase64(await request.arrayBuffer());

    this.sendConnector({
      type: "request",
      id,
      method: request.method,
      path: url.pathname + url.search,
      headers: serializeRequestHeaders(request.headers),
      body
    });

    return response;
  }

  proxyWebSocket(request) {
    const id = crypto.randomUUID();
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.websockets.set(id, server);

    server.addEventListener("message", (event) => {
      this.sendConnector({
        type: "websocket_message",
        id,
        ...serializeWebSocketData(event.data)
      });
    });
    server.addEventListener("close", (event) => {
      this.websockets.delete(id);
      this.sendConnector({
        type: "websocket_close",
        id,
        code: event.code,
        reason: event.reason
      });
    });
    server.addEventListener("error", () => {
      this.websockets.delete(id);
      this.sendConnector({
        type: "websocket_close",
        id,
        code: 1011,
        reason: "Worker socket error"
      });
    });

    this.sendConnector({
      type: "websocket_open",
      id,
      path: url.pathname + url.search,
      headers: serializeRequestHeaders(request.headers)
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  handleConnectorMessage(raw) {
    const message = parseMessage(raw);
    if (!message || message.type === "pong") {
      return;
    }

    if (message.type === "websocket_message") {
      const websocket = this.websockets.get(message.id);
      if (websocket?.readyState === 1) {
        websocket.send(deserializeWebSocketData(message));
      }
      return;
    }

    if (message.type === "websocket_close" || message.type === "websocket_error") {
      const websocket = this.websockets.get(message.id);
      this.websockets.delete(message.id);
      if (websocket?.readyState === 1) {
        websocket.close(message.code ?? 1011, message.reason ?? message.error ?? "Socket closed");
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    if (message.type === "response_start") {
      clearTimeout(pending.timeout);
      pending.started = true;
      const headers = new Headers();
      for (const [name, value] of message.headers ?? []) {
        headers.append(name, value);
      }
      headers.delete("content-length");
      pending.resolve(new Response(pending.stream, { status: message.status, headers }));
      return;
    }

    if (message.type === "response_body") {
      if (!pending.started) {
        clearTimeout(pending.timeout);
        pending.started = true;
        pending.resolve(new Response(pending.stream, { status: 200 }));
      }
      if (message.body) {
        pending.controller.enqueue(base64ToUint8Array(message.body));
      }
      if (message.done) {
        pending.controller.close();
        this.pending.delete(message.id);
      }
      return;
    }

    if (message.type === "response_error") {
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (pending.started) {
        pending.controller.error(new Error(message.error ?? "Local connector failed"));
      } else {
        pending.resolve(new Response(message.error ?? "Local connector failed", { status: 502 }));
      }
    }
  }

  isConnected() {
    return this.connector?.readyState === 1;
  }

  sendConnector(message) {
    if (this.isConnected()) {
      this.connector.send(JSON.stringify(message));
    }
  }

  failPending(message) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      if (pending.started) {
        pending.controller.error(new Error(message));
      } else {
        pending.resolve(new Response(message, { status: 503 }));
      }
      this.pending.delete(id);
    }

    for (const [id, websocket] of this.websockets.entries()) {
      if (websocket.readyState === 1) {
        websocket.close(1011, message);
      }
      this.websockets.delete(id);
    }
  }
}

export default {
  fetch(request, env) {
    const id = env.TUNNEL.idFromName("workspace");
    return env.TUNNEL.get(id).fetch(request);
  }
};

function serializeRequestHeaders(headers) {
  const entries = [];
  headers.forEach((value, name) => {
    if (!isHopByHopHeader(name)) {
      entries.push([name, value]);
    }
  });
  return entries;
}

function parseMessage(raw) {
  try {
    return JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  } catch {
    return null;
  }
}

function bearerToken(request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

async function verifyToken(token, expectedHash) {
  if (!token || !expectedHash) {
    return false;
  }
  return timingSafeEqual(await sha256Hex(token), expectedHash);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function serializeWebSocketData(data) {
  if (typeof data === "string") {
    return { text: data };
  }

  return { body: arrayBufferToBase64(data) };
}

function deserializeWebSocketData(message) {
  if (typeof message.text === "string") {
    return message.text;
  }

  return base64ToUint8Array(message.body ?? "");
}

function base64ToUint8Array(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isHopByHopHeader(name) {
  return [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
  ].includes(name.toLowerCase());
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
