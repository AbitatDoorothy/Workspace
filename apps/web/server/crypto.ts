import { sha256 } from "@noble/hashes/sha2";

export function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function randomId(prefix: string, byteLength = 8) {
  return `${prefix}_${randomHex(byteLength)}`;
}

export function sha256Hex(input: string) {
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
