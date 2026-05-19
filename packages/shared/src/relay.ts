import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type RelayTransport = "relay";

export interface RelayPairingPayload {
  version: 1;
  product: "abitat";
  endpoint: string;
  relayId: string;
  macId: string;
  pairingSecret: string;
  manualCode: string;
  expiresAt: string;
  transport: RelayTransport;
  capabilities: string[];
}

export interface RelayPlainRequest {
  body?: unknown;
  headers?: Record<string, string>;
  method: string;
  path: string;
  requestId: string;
}

export interface RelayPlainResponse {
  body?: unknown;
  headers?: Record<string, string>;
  requestId: string;
  status: number;
}

export interface RelayEncryptedEnvelope {
  ciphertext: string;
  createdAt: string;
  nonce: string;
  requestId: string;
  version: 1;
}

export interface RelayReplayCache {
  assertFresh(requestId: string, input?: { now?: Date; ttlMs?: number }): void;
}

const RELAY_CRYPTO_INFO = "abitat-relay-v1";
const DEFAULT_RELAY_ENVELOPE_MAX_AGE_MS = 2 * 60 * 1000;
const DEFAULT_REPLAY_TTL_MS = 10 * 60 * 1000;

export async function relaySessionKey(secret: string, relayId: string) {
  return hkdf(sha256, utf8(secret), utf8(relayId), utf8(RELAY_CRYPTO_INFO), 32);
}

export async function encryptRelayEnvelope(
  key: Uint8Array,
  value: RelayPlainRequest | RelayPlainResponse,
  input: { createdAt?: Date; nonce?: Uint8Array } = {}
): Promise<RelayEncryptedEnvelope> {
  const nonce = input.nonce ?? randomBytes(12);
  const createdAt = (input.createdAt ?? new Date()).toISOString();
  const plaintext = utf8(JSON.stringify(value));
  const ciphertext = gcm(key, nonce, utf8(`${value.requestId}:${createdAt}`)).encrypt(plaintext);

  return {
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    createdAt,
    nonce: base64UrlEncode(nonce),
    requestId: value.requestId,
    version: 1
  };
}

export async function decryptRelayEnvelope<T extends RelayPlainRequest | RelayPlainResponse>(
  key: Uint8Array,
  envelope: RelayEncryptedEnvelope
): Promise<T> {
  validateRelayEnvelope(envelope);

  try {
    const plaintext = gcm(
      key,
      base64UrlDecode(envelope.nonce),
      utf8(`${envelope.requestId}:${envelope.createdAt}`)
    ).decrypt(base64UrlDecode(envelope.ciphertext));
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as T;

    if (!parsed || typeof parsed !== "object" || parsed.requestId !== envelope.requestId) {
      throw new Error("Relay envelope request id mismatch");
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === "Relay envelope request id mismatch") {
      throw error;
    }
    throw new Error("Unable to decrypt relay envelope", { cause: error });
  }
}

export function validateRelayEnvelopeFreshness(input: {
  createdAt: string;
  maxAgeMs?: number;
  now?: Date;
}) {
  const createdAtMs = Date.parse(input.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    throw new Error("Relay envelope timestamp is invalid");
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_RELAY_ENVELOPE_MAX_AGE_MS;
  if (Math.abs(nowMs - createdAtMs) > maxAgeMs) {
    throw new Error("Relay envelope is too old");
  }
}

export function createRelayReplayCache(): RelayReplayCache {
  const seen = new Map<string, number>();

  return {
    assertFresh(requestId, input = {}) {
      const nowMs = (input.now ?? new Date()).getTime();
      const ttlMs = input.ttlMs ?? DEFAULT_REPLAY_TTL_MS;

      for (const [candidate, expiresAt] of seen) {
        if (expiresAt <= nowMs) {
          seen.delete(candidate);
        }
      }

      if (seen.has(requestId)) {
        throw new Error("Relay request has already been processed");
      }

      seen.set(requestId, nowMs + ttlMs);
    }
  };
}

export function sha256Hex(value: string) {
  return bytesToHex(sha256(utf8(value)));
}

export function base64UrlEncode(bytes: Uint8Array) {
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return base64Decode(padded);
}

function validateRelayEnvelope(envelope: RelayEncryptedEnvelope) {
  if (
    envelope.version !== 1 ||
    !envelope.requestId ||
    !envelope.createdAt ||
    !envelope.nonce ||
    !envelope.ciphertext
  ) {
    throw new Error("Relay envelope is invalid");
  }
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error("Secure random bytes are unavailable");
  }
  crypto.getRandomValues(bytes);
  return bytes;
}

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Encode(bytes: Uint8Array) {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;

    output += BASE64_ALPHABET[(triplet >> 18) & 63];
    output += BASE64_ALPHABET[(triplet >> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(triplet >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? BASE64_ALPHABET[triplet & 63] : "=";
  }
  return output;
}

function base64Decode(value: string) {
  const clean = value.replace(/\s/g, "");
  if (clean.length % 4 !== 0) {
    throw new Error("Invalid base64 value");
  }

  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((clean.length / 4) * 3 - padding);
  let byteIndex = 0;

  for (let index = 0; index < clean.length; index += 4) {
    const first = base64Value(clean[index]);
    const second = base64Value(clean[index + 1]);
    const third = clean[index + 2] === "=" ? 0 : base64Value(clean[index + 2]);
    const fourth = clean[index + 3] === "=" ? 0 : base64Value(clean[index + 3]);
    const triplet = (first << 18) | (second << 12) | (third << 6) | fourth;

    if (byteIndex < bytes.length) bytes[byteIndex++] = (triplet >> 16) & 255;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triplet >> 8) & 255;
    if (byteIndex < bytes.length) bytes[byteIndex++] = triplet & 255;
  }

  return bytes;
}

function base64Value(character: string | undefined) {
  const value = character ? BASE64_ALPHABET.indexOf(character) : -1;
  if (value < 0) {
    throw new Error("Invalid base64 value");
  }
  return value;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
