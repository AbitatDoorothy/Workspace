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
  createRelayReplayCache,
  handleRelayRequest,
  handleRelaySocketMessage
} from "../src/local-control/relay-client";
import { createLocalControlStore, hashLocalControlToken } from "../src/local-control/state";

describe("local relay client", () => {
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
