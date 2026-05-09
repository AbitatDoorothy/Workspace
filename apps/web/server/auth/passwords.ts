import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { scrypt } from "@noble/hashes/scrypt";
import { sha256 } from "@noble/hashes/sha2";

import { randomHex } from "../crypto";

const LEGACY_SCRYPT_N = 16_384;
const LEGACY_SCRYPT_R = 8;
const LEGACY_SCRYPT_P = 1;
const PBKDF2_ITERATIONS = 120_000;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;

interface HashPasswordOptions {
  salt?: Uint8Array;
}

export async function hashPassword(password: string, options: HashPasswordOptions = {}) {
  const salt = options.salt ?? decodeHex(randomHex(SALT_LENGTH));
  const derived = pbkdf2(sha256, password, salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_LENGTH
  });

  return [
    "pbkdf2-sha256",
    String(PBKDF2_ITERATIONS),
    String(KEY_LENGTH),
    encodeBase64Url(salt),
    encodeBase64Url(derived)
  ].join("$");
}

export async function verifyPassword(password: string, storedHash: string) {
  const parts = storedHash.split("$");
  switch (parts[0]) {
    case "pbkdf2-sha256":
      return verifyPbkdf2Password(password, parts);
    case "scrypt":
      return verifyLegacyScryptPassword(password, parts);
    default:
      return false;
  }
}

async function verifyPbkdf2Password(password: string, parts: string[]) {
  if (parts.length !== 5) {
    return false;
  }

  const [, iterationsText, keyLengthText, saltText, hashText] = parts;
  const iterations = Number(iterationsText);
  const keyLength = Number(keyLengthText);
  if (!Number.isInteger(iterations) || !Number.isInteger(keyLength)) {
    return false;
  }

  try {
    const salt = decodeBase64Url(saltText);
    const expected = decodeBase64Url(hashText);
    const actual = pbkdf2(sha256, password, salt, {
      c: iterations,
      dkLen: keyLength
    });

    return timingSafeEqualBytes(expected, actual);
  } catch {
    return false;
  }
}

async function verifyLegacyScryptPassword(password: string, parts: string[]) {
  if (parts.length !== 6) {
    return false;
  }

  const [, nText, rText, pText, saltText, hashText] = parts;
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  try {
    const salt = decodeBase64Url(saltText);
    const expected = decodeBase64Url(hashText);
    const actual = scrypt(password, salt, {
      N: n || LEGACY_SCRYPT_N,
      dkLen: expected.length,
      p: p || LEGACY_SCRYPT_P,
      r: r || LEGACY_SCRYPT_R
    });

    return timingSafeEqualBytes(expected, actual);
  } catch {
    return false;
  }
}

function timingSafeEqualBytes(expected: Uint8Array, actual: Uint8Array) {
  if (expected.length !== actual.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ actual[index];
  }
  return difference === 0;
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeHex(input: string) {
  const bytes = new Uint8Array(input.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(input.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
