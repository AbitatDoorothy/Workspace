import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createLocalControlStore, hashLocalControlToken } from "../src/local-control/state";

describe("local control state", () => {
  it("creates short-lived single-use pairing payloads and stores only token hashes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-control-state-"));
    const statePath = join(directory, "state.json");
    let now = new Date("2026-05-09T12:00:00.000Z");
    let secretIndex = 0;
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      now: () => now,
      randomSecret: () => `secret_${++secretIndex}`,
      statePath
    });

    try {
      const pairing = await store.createPairing({
        endpoint: "http://100.64.1.2:3901",
        transport: "tailscale"
      });

      expect(pairing).toMatchObject({
        endpoint: "http://100.64.1.2:3901",
        macId: "mac_test",
        pairingSecret: "secret_2",
        product: "abitat",
        transport: "tailscale",
        version: 1
      });
      expect(pairing.manualCode).toMatch(/^ABITAT-[0-9A-F]{4}-[0-9A-F]{4}$/u);

      const paired = await store.consumePairing({
        deviceName: "Reece iPhone",
        pairingSecret: pairing.pairingSecret,
        platform: "ios"
      });

      expect(paired.clientToken).toBe("secret_4");
      expect(paired.machineId).toBe("phone_test");
      await expect(store.requireDeviceByToken(paired.clientToken)).resolves.toMatchObject({
        id: "phone_test",
        name: "Reece iPhone",
        tokenHash: hashLocalControlToken("secret_4")
      });
      await expect(store.requireDeviceByToken("wrong-token")).rejects.toThrow(
        "Invalid mobile token"
      );
      await expect(
        store.consumePairing({
          deviceName: "Other iPhone",
          pairingSecret: pairing.pairingSecret,
          platform: "ios"
        })
      ).rejects.toThrow("Pairing code has already been used");

      const manualPairing = await store.createPairing({
        endpoint: "https://demo.lhr.life",
        transport: "manual"
      });
      const manuallyPaired = await store.consumePairing({
        code: manualPairing.manualCode.toLowerCase().replaceAll("-", " - "),
        deviceName: "Manual iPhone",
        platform: "ios"
      });
      expect(manuallyPaired.machineId).toBe("phone_test");

      const persisted = createLocalControlStore({ statePath });
      await expect(persisted.requireDeviceByToken(paired.clientToken)).resolves.toMatchObject({
        id: "phone_test"
      });

      now = new Date("2026-05-09T12:06:00.000Z");
      const expired = await store.createPairing({
        endpoint: "http://100.64.1.2:3901",
        transport: "tailscale",
        ttlMs: 1
      });
      now = new Date("2026-05-09T12:06:01.000Z");
      await expect(
        store.consumePairing({
          deviceName: "Late iPhone",
          pairingSecret: expired.pairingSecret,
          platform: "ios"
        })
      ).rejects.toThrow("Pairing code has expired");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("tracks relay pairing and device key material without storing mobile tokens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-control-relay-state-"));
    const statePath = join(directory, "state.json");
    let secretIndex = 0;
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      randomSecret: () => `secret_${++secretIndex}`,
      statePath
    });

    try {
      const pairing = await store.createPairing({
        endpoint: "https://workspace.abitat.io",
        relayId: "relay_test",
        transport: "relay"
      });

      expect(pairing).toMatchObject({
        endpoint: "https://workspace.abitat.io",
        relayId: "relay_test",
        transport: "relay"
      });

      await expect(store.getRelayKeyMaterials("relay_test")).resolves.toEqual([
        {
          id: "pairing_test",
          kind: "pairing",
          keyMaterial: hashLocalControlToken(pairing.pairingSecret)
        }
      ]);

      const paired = await store.consumePairing({
        deviceName: "Relay iPhone",
        pairingSecret: pairing.pairingSecret,
        platform: "ios"
      });

      await expect(store.getRelayKeyMaterials("relay_test")).resolves.toEqual([
        {
          id: "phone_test",
          kind: "device",
          keyMaterial: hashLocalControlToken(paired.clientToken)
        }
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists Expo push subscriptions for paired phones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-control-push-state-"));
    const statePath = join(directory, "state.json");
    let now = new Date("2026-05-09T12:00:00.000Z");
    let secretIndex = 0;
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      now: () => now,
      randomSecret: () => `secret_${++secretIndex}`,
      statePath
    });

    try {
      const pairing = await store.createPairing({
        endpoint: "https://workspace.abitat.io",
        relayId: "relay_push_test",
        transport: "relay"
      });
      const paired = await store.consumePairing({
        deviceName: "Push iPhone",
        pairingSecret: pairing.pairingSecret,
        platform: "ios"
      });

      await expect(
        store.registerPushSubscription(paired.machineId, {
          platform: "ios",
          provider: "expo",
          token: "ExponentPushToken[first]"
        })
      ).resolves.toMatchObject({
        deviceId: "phone_test",
        platform: "ios",
        provider: "expo",
        token: "ExponentPushToken[first]"
      });

      now = new Date("2026-05-09T12:05:00.000Z");
      await store.registerPushSubscription(paired.machineId, {
        platform: "ios",
        provider: "expo",
        token: "ExponentPushToken[first]"
      });
      await store.registerPushSubscription(paired.machineId, {
        platform: "ios",
        provider: "expo",
        token: "ExponentPushToken[second]"
      });

      await expect(store.listPushSubscriptions()).resolves.toEqual([
        expect.objectContaining({
          deviceId: "phone_test",
          lastSeenAt: "2026-05-09T12:05:00.000Z",
          provider: "expo",
          token: "ExponentPushToken[first]"
        }),
        expect.objectContaining({
          deviceId: "phone_test",
          registeredAt: "2026-05-09T12:05:00.000Z",
          provider: "expo",
          token: "ExponentPushToken[second]"
        })
      ]);

      const restarted = createLocalControlStore({ statePath });
      await expect(restarted.listPushSubscriptions()).resolves.toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("waits out transient partial state files during mobile auth", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-control-auth-race-"));
    const statePath = join(directory, "state.json");
    const store = createLocalControlStore({ statePath });
    const validState = {
      version: 1,
      macId: "mac_race",
      macName: "Race Mac",
      hostTokenHash: hashLocalControlToken("host-token"),
      pairedDevices: [
        {
          id: "phone_race",
          name: "Race iPhone",
          platform: "ios",
          pushSubscriptions: [],
          tokenHash: hashLocalControlToken("client-token"),
          pairedAt: "2026-05-09T12:00:00.000Z",
          lastSeenAt: "2026-05-09T12:00:00.000Z",
          relayId: "relay_race",
          revokedAt: null
        }
      ],
      activePairings: []
    };

    try {
      await writeFile(statePath, "", "utf8");
      setTimeout(() => {
        void writeFile(statePath, `${JSON.stringify(validState, null, 2)}\n`, "utf8");
      }, 5);

      await expect(store.requireDeviceByToken("client-token")).resolves.toMatchObject({
        id: "phone_race",
        name: "Race iPhone"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists one relay id per Mac so paired phones can reconnect after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-control-relay-id-state-"));
    const statePath = join(directory, "state.json");
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_stable_test`,
      statePath
    });

    try {
      await expect(store.getRelayId()).resolves.toBe("relay_stable_test");

      const restarted = createLocalControlStore({
        idGenerator: (prefix) => `${prefix}_new_test`,
        statePath
      });
      await expect(restarted.getRelayId()).resolves.toBe("relay_stable_test");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reuses an existing relay device room when upgrading older local state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-control-relay-id-migration-"));
    const statePath = join(directory, "state.json");
    let secretIndex = 0;
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      randomSecret: () => `secret_${++secretIndex}`,
      statePath
    });

    try {
      const pairing = await store.createPairing({
        endpoint: "https://workspace.abitat.io",
        relayId: "relay_existing_device",
        transport: "relay"
      });
      await store.consumePairing({
        deviceName: "Existing Relay iPhone",
        pairingSecret: pairing.pairingSecret,
        platform: "ios"
      });

      const upgraded = createLocalControlStore({
        idGenerator: (prefix) => `${prefix}_new_test`,
        statePath
      });
      await expect(upgraded.getRelayId()).resolves.toBe("relay_existing_device");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
