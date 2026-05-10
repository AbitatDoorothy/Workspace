import { describe, expect, it } from "vitest";

import { RelayHostRejectedError, RelayOfflineError, RelayRoomCore } from "../src/relay-room-core";

describe("RelayRoomCore", () => {
  it("acknowledges Mac host heartbeats", () => {
    const room = new RelayRoomCore();
    const host = new FakeRelaySocket();
    room.connectHost(host);

    host.receive({
      sentAt: "2026-05-10T20:00:00.000Z",
      type: "heartbeat"
    });

    expect(JSON.parse(host.sent[1] ?? "{}")).toMatchObject({
      sentAt: "2026-05-10T20:00:00.000Z",
      type: "heartbeat_ack"
    });
    expect(room.status()).toMatchObject({ connected: true, pending: 0 });
  });

  it("reports stale Mac host sockets offline instead of timing out phone requests", () => {
    let now = 1_000;
    const room = new RelayRoomCore({
      hostStaleMs: 10_000,
      now: () => now
    });
    const host = new FakeRelaySocket();
    room.connectHost(host);

    now = 12_000;

    expect(room.status()).toMatchObject({ connected: false, pending: 0 });
    expect(() =>
      room.request({
        ciphertext: "request-ciphertext",
        createdAt: "2026-05-10T10:00:00.000Z",
        nonce: "request-nonce",
        requestId: "req_stale",
        version: 1
      })
    ).toThrow(RelayOfflineError);
    expect(host.closeReason).toBe("Mac relay heartbeat timed out");
  });

  it("forwards an opaque phone request to the connected Mac host", async () => {
    const room = new RelayRoomCore();
    const host = new FakeRelaySocket();
    room.connectHost(host);

    const responsePromise = room.request({
      ciphertext: "request-ciphertext",
      createdAt: "2026-05-10T10:00:00.000Z",
      nonce: "request-nonce",
      requestId: "req_1",
      version: 1
    });

    expect(JSON.parse(host.sent[1] ?? "{}")).toEqual({
      envelope: {
        ciphertext: "request-ciphertext",
        createdAt: "2026-05-10T10:00:00.000Z",
        nonce: "request-nonce",
        requestId: "req_1",
        version: 1
      },
      requestId: "req_1",
      type: "request"
    });

    host.receive({
      envelope: {
        ciphertext: "response-ciphertext",
        createdAt: "2026-05-10T10:00:01.000Z",
        nonce: "response-nonce",
        requestId: "req_1",
        version: 1
      },
      requestId: "req_1",
      type: "response"
    });

    await expect(responsePromise).resolves.toMatchObject({
      ciphertext: "response-ciphertext",
      requestId: "req_1"
    });
  });

  it("reports offline when no Mac host is connected", () => {
    const room = new RelayRoomCore();

    expect(() =>
      room.request({
        ciphertext: "request-ciphertext",
        createdAt: "2026-05-10T10:00:00.000Z",
        nonce: "request-nonce",
        requestId: "req_2",
        version: 1
      })
    ).toThrow(RelayOfflineError);
  });

  it("fails pending phone requests when the Mac host disconnects", async () => {
    const room = new RelayRoomCore();
    const host = new FakeRelaySocket();
    room.connectHost(host);

    const responsePromise = room.request({
      ciphertext: "request-ciphertext",
      createdAt: "2026-05-10T10:00:00.000Z",
      nonce: "request-nonce",
      requestId: "req_3",
      version: 1
    });

    host.close();

    await expect(responsePromise).rejects.toThrow("Mac relay disconnected");
  });

  it("surfaces explicit Mac host rejections without disconnecting the room", async () => {
    const room = new RelayRoomCore();
    const host = new FakeRelaySocket();
    room.connectHost(host);

    const responsePromise = room.request({
      ciphertext: "request-ciphertext",
      createdAt: "2026-05-10T10:00:00.000Z",
      nonce: "request-nonce",
      requestId: "req_rejected",
      version: 1
    });

    host.receive({
      error: "Relay request could not be decrypted by this Mac",
      requestId: "req_rejected",
      status: 401,
      type: "error"
    });

    await expect(responsePromise).rejects.toMatchObject({
      message: "Relay request could not be decrypted by this Mac",
      status: 401
    } satisfies Partial<RelayHostRejectedError>);
    expect(room.status()).toMatchObject({ connected: true, pending: 0 });
  });

  it("isolates requests by relay room instance", () => {
    const firstRoom = new RelayRoomCore();
    const secondRoom = new RelayRoomCore();
    const firstHost = new FakeRelaySocket();
    firstRoom.connectHost(firstHost);

    expect(() =>
      secondRoom.request({
        ciphertext: "request-ciphertext",
        createdAt: "2026-05-10T10:00:00.000Z",
        nonce: "request-nonce",
        requestId: "req_4",
        version: 1
      })
    ).toThrow(RelayOfflineError);
    expect(firstHost.sent).toHaveLength(1);
  });
});

class FakeRelaySocket implements RelayRoomCoreSocket {
  private readonly listeners = new Map<string, Array<(event: any) => void>>();
  closeReason = "";
  readyState = 1;
  sent: string[] = [];

  addEventListener(event: "close" | "error" | "message", listener: (event: any) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  close(_code?: number, reason?: string) {
    this.closeReason = reason ?? "";
    this.readyState = 3;
    this.emit("close", {});
  }

  receive(message: unknown) {
    this.emit("message", { data: JSON.stringify(message) });
  }

  send(message: string) {
    this.sent.push(message);
  }

  private emit(event: "close" | "error" | "message", payload: any) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

interface RelayRoomCoreSocket {
  addEventListener(event: "close" | "error" | "message", listener: (event: any) => void): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  send(message: string): void;
}
