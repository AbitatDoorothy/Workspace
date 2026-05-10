import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  decryptRelayEnvelope,
  encryptRelayEnvelope,
  relaySessionKey,
  type RelayEncryptedEnvelope
} from "@abitat_reece/shared";

import {
  createRelayHeartbeatController,
  createRelayReplayCache,
  handleRelayRequest,
  handleRelaySocketMessage
} from "../src/local-control/relay-client";
import { createLocalControlStore, hashLocalControlToken } from "../src/local-control/state";

describe("local relay client", () => {
  it("closes stale relay sockets when heartbeat acknowledgements stop", () => {
    let now = 1_000;
    const scheduled: Array<() => void> = [];
    const clearedTimers: number[] = [];
    const socket = {
      closed: false,
      readyState: 1,
      sent: [] as string[],
      close() {
        this.closed = true;
        this.readyState = 3;
      },
      send(message: string) {
        this.sent.push(message);
      }
    };
    const controller = createRelayHeartbeatController({
      clearIntervalFn: (timer) => clearedTimers.push(timer as number),
      heartbeatIntervalMs: 10_000,
      now: () => now,
      setIntervalFn: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      socket: socket as any,
      staleAfterMs: 30_000
    });

    controller.start();
    scheduled[0]?.();
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({ type: "heartbeat" });

    controller.handleHeartbeatAck();
    now = 40_001;
    scheduled[0]?.();

    expect(socket.closed).toBe(true);
    controller.stop();
    expect(clearedTimers).toContain(1);
  });

  it("terminates stale relay sockets when force close is available", () => {
    let now = 1_000;
    const scheduled: Array<() => void> = [];
    const socket = {
      closed: false,
      readyState: 1,
      sent: [] as string[],
      close() {
        this.closed = true;
        this.readyState = 3;
      },
      send(message: string) {
        this.sent.push(message);
      },
      terminated: false,
      terminate() {
        this.terminated = true;
        this.readyState = 3;
      }
    };
    const controller = createRelayHeartbeatController({
      heartbeatIntervalMs: 10_000,
      now: () => now,
      setIntervalFn: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      socket: socket as any,
      staleAfterMs: 30_000
    });

    controller.start();
    controller.handleHeartbeatAck();
    now = 40_001;
    scheduled[0]?.();

    expect(socket.terminated).toBe(true);
    expect(socket.closed).toBe(false);
  });

  it("decrypts relay requests, forwards them to the local API, and encrypts responses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-relay-client-state-"));
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      randomSecret: (() => {
        let index = 0;
        return () => `secret_${++index}`;
      })(),
      statePath: join(directory, "state.json")
    });

    try {
      const pairing = await store.createPairing({
        endpoint: "https://workspace.abitat.io",
        relayId: "relay_test",
        transport: "relay"
      });
      const paired = await store.consumePairing({
        deviceName: "Relay iPhone",
        pairingSecret: pairing.pairingSecret,
        platform: "ios"
      });
      const key = await relaySessionKey(hashLocalControlToken(paired.clientToken), "relay_test");
      const request = await encryptRelayEnvelope(key, {
        headers: {
          authorization: `Bearer ${paired.clientToken}`
        },
        method: "GET",
        path: "/api/mobile/projects",
        requestId: "req_1"
      });

      const response = await handleRelayRequest({
        envelope: request,
        fetch: async (url, init) => {
          expect(String(url)).toBe("http://127.0.0.1:3901/api/mobile/projects");
          expect(init?.headers).toMatchObject({
            authorization: `Bearer ${paired.clientToken}`
          });
          return Response.json({ projects: [{ id: "codex_project_demo" }] });
        },
        localEndpoint: "http://127.0.0.1:3901",
        relayId: "relay_test",
        replayCache: createRelayReplayCache(),
        store
      });

      await expect(decryptRelayEnvelope(key, response)).resolves.toMatchObject({
        body: { projects: [{ id: "codex_project_demo" }] },
        requestId: "req_1",
        status: 200
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects relay requests that cannot be decrypted by this Mac", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-relay-client-reject-state-"));
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      randomSecret: () => "secret",
      statePath: join(directory, "state.json")
    });
    const key = await relaySessionKey("wrong-key-material", "relay_test");
    const request = await encryptRelayEnvelope(key, {
      method: "GET",
      path: "/api/mobile/projects",
      requestId: "req_2"
    });

    try {
      await expect(
        handleRelayRequest({
          envelope: request,
          fetch: async () => Response.json({}),
          localEndpoint: "http://127.0.0.1:3901",
          relayId: "relay_test",
          replayCache: createRelayReplayCache(),
          store
        })
      ).rejects.toThrow("Relay request could not be decrypted by this Mac");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("answers undecryptable socket requests with a host rejection instead of throwing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-relay-client-socket-reject-state-"));
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      randomSecret: () => "secret",
      statePath: join(directory, "state.json")
    });
    const key = await relaySessionKey("wrong-key-material", "relay_test");
    const envelope = await encryptRelayEnvelope(key, {
      method: "GET",
      path: "/api/mobile/projects",
      requestId: "req_socket_reject"
    });
    const socket = {
      readyState: 1,
      sent: [] as string[],
      send(message: string) {
        this.sent.push(message);
      }
    };

    try {
      await handleRelaySocketMessage(
        JSON.stringify({
          envelope,
          requestId: "req_socket_reject",
          type: "request"
        }),
        {
          fetch: async () => Response.json({}),
          localEndpoint: "http://127.0.0.1:3901",
          relayId: "relay_test",
          replayCache: createRelayReplayCache(),
          socket: socket as any,
          store
        }
      );

      expect(socket.sent).toHaveLength(1);
      expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
        error: "Relay request could not be decrypted by this Mac",
        requestId: "req_socket_reject",
        status: 401,
        type: "error"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects replayed relay requests before reaching the local API", async () => {
    const keyMaterial = hashLocalControlToken("client-token");
    const key = await relaySessionKey(keyMaterial, "relay_test");
    const envelope = await encryptRelayEnvelope(key, {
      method: "GET",
      path: "/api/mobile/projects",
      requestId: "req_3"
    });
    const replayCache = createRelayReplayCache();
    const store = {
      async getRelayKeyMaterials() {
        return [{ id: "phone_test", kind: "device" as const, keyMaterial }];
      }
    };

    await handleRelayRequest({
      envelope,
      fetch: async () => Response.json({ ok: true }),
      localEndpoint: "http://127.0.0.1:3901",
      relayId: "relay_test",
      replayCache,
      store
    });

    await expect(
      handleRelayRequest({
        envelope,
        fetch: async () => {
          throw new Error("fetch should not run");
        },
        localEndpoint: "http://127.0.0.1:3901",
        relayId: "relay_test",
        replayCache,
        store
      })
    ).rejects.toThrow("Relay request has already been processed");
  });
});
