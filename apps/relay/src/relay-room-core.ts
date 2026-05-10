import type { RelayEncryptedEnvelope } from "@abitat_reece/shared";

export interface RelayHostSocket {
  addEventListener(event: "close" | "error" | "message", listener: (event: any) => void): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  send(message: string): void;
}

export interface RelayRoomStatus {
  connected: boolean;
  pending: number;
}

interface PendingRelayRequest {
  reject(error: Error): void;
  resolve(envelope: RelayEncryptedEnvelope): void;
  timer: ReturnType<typeof setTimeout>;
}

interface RelayHostRequestMessage {
  envelope: RelayEncryptedEnvelope;
  requestId: string;
  type: "request";
}

interface RelayHostResponseMessage {
  envelope: RelayEncryptedEnvelope;
  requestId: string;
  type: "response";
}

interface RelayHostErrorMessage {
  error: string;
  requestId: string;
  status: number;
  type: "error";
}

interface RelayHostHeartbeatMessage {
  sentAt?: string;
  type: "heartbeat";
}

interface RelayRoomCoreOptions {
  hostStaleMs?: number;
  now?: () => number;
}

const OPEN = 1;
const DEFAULT_HOST_STALE_MS = 45_000;

export class RelayRoomCore {
  private host: RelayHostSocket | null = null;
  private lastHostSeenAtMs = 0;
  private readonly pending = new Map<string, PendingRelayRequest>();
  private readonly hostStaleMs: number;
  private readonly now: () => number;

  constructor(options: RelayRoomCoreOptions = {}) {
    this.hostStaleMs = options.hostStaleMs ?? DEFAULT_HOST_STALE_MS;
    this.now = options.now ?? Date.now;
  }

  connectHost(socket: RelayHostSocket) {
    if (this.isConnected()) {
      this.host?.close(1012, "Host replaced");
      this.failPending("Mac relay connection was replaced");
    }

    this.host = socket;
    this.lastHostSeenAtMs = this.now();
    socket.addEventListener("message", (event) => this.handleHostMessage(event.data));
    socket.addEventListener("close", () => this.disconnectHost(socket, "Mac relay disconnected"));
    socket.addEventListener("error", () => this.disconnectHost(socket, "Mac relay errored"));
    socket.send(JSON.stringify({ type: "connected" }));
  }

  status(): RelayRoomStatus {
    return {
      connected: Boolean(this.connectedHost()),
      pending: this.pending.size
    };
  }

  request(envelope: RelayEncryptedEnvelope, input: { timeoutMs?: number } = {}) {
    const host = this.connectedHost();
    if (!host) {
      throw new RelayOfflineError("Mac is offline");
    }

    const requestId = envelope.requestId;
    const timeoutMs = input.timeoutMs ?? 30_000;
    const message: RelayHostRequestMessage = {
      envelope,
      requestId,
      type: "request"
    };

    return new Promise<RelayEncryptedEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new RelayTimeoutError("Mac did not answer relay request in time"));
      }, timeoutMs);

      this.pending.set(requestId, { reject, resolve, timer });
      host.send(JSON.stringify(message));
    });
  }

  private isConnected() {
    return this.host?.readyState === OPEN;
  }

  private connectedHost() {
    if (!this.isConnected() || !this.host) {
      return null;
    }

    if (this.now() - this.lastHostSeenAtMs > this.hostStaleMs) {
      const staleHost = this.host;
      staleHost.close(1011, "Mac relay heartbeat timed out");
      this.disconnectHost(staleHost, "Mac relay heartbeat timed out");
      return null;
    }

    return this.host;
  }

  private disconnectHost(socket: RelayHostSocket, reason: string) {
    if (this.host !== socket) {
      return;
    }

    this.host = null;
    this.failPending(reason);
  }

  private failPending(reason: string) {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RelayOfflineError(reason));
      this.pending.delete(requestId);
    }
  }

  private handleHostMessage(raw: unknown) {
    const message = parseHostMessage(raw);
    if (!message) {
      return;
    }

    this.lastHostSeenAtMs = this.now();
    if (message.type === "heartbeat") {
      this.host?.send(
        JSON.stringify({
          sentAt: message.sentAt,
          serverTime: new Date(this.now()).toISOString(),
          type: "heartbeat_ack"
        })
      );
      return;
    }

    const pending = this.pending.get(message.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.type === "error") {
      pending.reject(new RelayHostRejectedError(message.error, message.status));
      return;
    }
    pending.resolve(message.envelope);
  }
}

export class RelayOfflineError extends Error {
  readonly status = 503;
}

export class RelayTimeoutError extends Error {
  readonly status = 504;
}

export class RelayHostRejectedError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function parseHostMessage(
  raw: unknown
): RelayHostResponseMessage | RelayHostErrorMessage | RelayHostHeartbeatMessage | null {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, any>;
    if (parsed.type === "heartbeat") {
      return {
        sentAt: typeof parsed.sentAt === "string" ? parsed.sentAt : undefined,
        type: "heartbeat"
      };
    }

    if (
      parsed.type === "error" &&
      typeof parsed.requestId === "string" &&
      typeof parsed.error === "string"
    ) {
      return {
        error: parsed.error,
        requestId: parsed.requestId,
        status: typeof parsed.status === "number" ? parsed.status : 500,
        type: "error"
      };
    }

    if (
      parsed.type !== "response" ||
      typeof parsed.requestId !== "string" ||
      !parsed.envelope ||
      parsed.envelope.requestId !== parsed.requestId
    ) {
      return null;
    }

    return parsed as RelayHostResponseMessage;
  } catch {
    return null;
  }
}
