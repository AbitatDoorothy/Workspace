import { DurableObject } from "cloudflare:workers";

import {
  RelayHostRejectedError,
  RelayOfflineError,
  RelayRoomCore,
  RelayTimeoutError
} from "./relay-room-core";

interface Env {
  RELAY_ROOMS: DurableObjectNamespace<RelayRoom>;
}

const RELAY_REQUEST_TIMEOUT_MS = 30_000;

export class RelayRoom extends DurableObject<Env> {
  private readonly core = new RelayRoomCore();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = relayAction(url.pathname);

    if (request.method === "GET" && action === "status") {
      return json(this.core.status());
    }

    if (request.method === "GET" && action === "host") {
      return this.connectHost(request);
    }

    if (request.method === "POST" && action === "request") {
      return this.handlePhoneRequest(request);
    }

    return json({ error: "Not found" }, { status: 404 });
  }

  private connectHost(request: Request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Expected WebSocket upgrade" }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.core.connectHost(server);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private async handlePhoneRequest(request: Request) {
    const body = (await request.json().catch(() => null)) as { envelope?: unknown } | null;
    if (!body?.envelope || typeof body.envelope !== "object") {
      return json({ error: "Missing relay envelope" }, { status: 400 });
    }

    try {
      const envelope = await this.core.request(body.envelope as any, {
        timeoutMs: RELAY_REQUEST_TIMEOUT_MS
      });
      return json({ envelope });
    } catch (error) {
      if (
        error instanceof RelayHostRejectedError ||
        error instanceof RelayOfflineError ||
        error instanceof RelayTimeoutError
      ) {
        return json({ error: error.message }, { status: error.status });
      }
      return json({ error: "Relay request failed" }, { status: 500 });
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      (url.pathname === "/health" || url.pathname === "/relay/health")
    ) {
      return json({ ok: true, service: "abitat-relay" });
    }

    const match = url.pathname.match(/^\/relay\/([^/]+)\/(host|request|status)$/u);
    if (!match) {
      return json({ error: "Not found" }, { status: 404 });
    }

    const relayId = decodeURIComponent(match[1]);
    if (!isValidRelayId(relayId)) {
      return json({ error: "Invalid relay id" }, { status: 400 });
    }

    const stub = env.RELAY_ROOMS.get(env.RELAY_ROOMS.idFromName(relayId));
    return stub.fetch(request);
  }
};

function relayAction(pathname: string) {
  return pathname.split("/").filter(Boolean).at(-1);
}

function isValidRelayId(value: string) {
  return /^relay_[a-zA-Z0-9_-]{8,96}$/u.test(value);
}

function json(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      ...(init.headers ?? {})
    }
  });
}
