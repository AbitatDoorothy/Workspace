import { describe, expect, it } from "vitest";

import {
  createRelayReplayCache,
  decryptRelayEnvelope,
  encryptRelayEnvelope,
  relaySessionKey,
  validateRelayEnvelopeFreshness
} from "../src/relay";

describe("relay protocol", () => {
  it("encrypts and decrypts relay envelopes with the same secret", async () => {
    const key = await relaySessionKey("pairing-secret", "relay_123");
    const envelope = await encryptRelayEnvelope(key, {
      body: { pairingSecret: "pairing-secret" },
      method: "POST",
      path: "/pairing/consume",
      requestId: "req_1"
    });

    await expect(decryptRelayEnvelope(key, envelope)).resolves.toMatchObject({
      body: { pairingSecret: "pairing-secret" },
      method: "POST",
      path: "/pairing/consume",
      requestId: "req_1"
    });
  });

  it("rejects envelopes decrypted with a different secret", async () => {
    const correctKey = await relaySessionKey("pairing-secret", "relay_123");
    const wrongKey = await relaySessionKey("wrong-secret", "relay_123");
    const envelope = await encryptRelayEnvelope(correctKey, {
      body: { ok: true },
      method: "GET",
      path: "/api/mobile/projects",
      requestId: "req_2"
    });

    await expect(decryptRelayEnvelope(wrongKey, envelope)).rejects.toThrow(
      "Unable to decrypt relay envelope"
    );
  });

  it("rejects tampered relay envelope ciphertext", async () => {
    const key = await relaySessionKey("client-token", "relay_123");
    const envelope = await encryptRelayEnvelope(key, {
      body: { ok: true },
      method: "GET",
      path: "/api/mobile/projects",
      requestId: "req_3"
    });

    await expect(
      decryptRelayEnvelope(key, {
        ...envelope,
        ciphertext: `${envelope.ciphertext.slice(0, -2)}AA`
      })
    ).rejects.toThrow("Unable to decrypt relay envelope");
  });

  it("rejects stale envelopes", async () => {
    expect(() =>
      validateRelayEnvelopeFreshness({
        createdAt: "2026-05-10T09:00:00.000Z",
        maxAgeMs: 60_000,
        now: new Date("2026-05-10T09:02:01.000Z")
      })
    ).toThrow("Relay envelope is too old");
  });

  it("rejects replayed request ids", () => {
    const cache = createRelayReplayCache();

    expect(() =>
      cache.assertFresh("req_4", {
        now: new Date("2026-05-10T09:00:00.000Z")
      })
    ).not.toThrow();
    expect(() =>
      cache.assertFresh("req_4", {
        now: new Date("2026-05-10T09:00:01.000Z")
      })
    ).toThrow("Relay request has already been processed");
  });
});
