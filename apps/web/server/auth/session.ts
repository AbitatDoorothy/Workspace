import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";

export const SESSION_COOKIE_NAME = "abitat_session";
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_LOGIN_PASSWORD = "abitat-local";
const DEFAULT_SESSION_SECRET = "local-dev-secret";

export interface BrowserSession {
  userId: string;
}

export function getLoginPassword(env: Partial<Record<string, string | undefined>> = process.env) {
  return env.ABITAT_LOGIN_PASSWORD ?? DEFAULT_LOGIN_PASSWORD;
}

export function getSessionSecret(env: Partial<Record<string, string | undefined>> = process.env) {
  return env.ABITAT_SESSION_SECRET ?? env.NEXTAUTH_SECRET ?? DEFAULT_SESSION_SECRET;
}

export function verifyLoginPassword(input: string, expected = getLoginPassword()) {
  return input === expected;
}

export function createPublicRedirectUrl(
  request: Request,
  path: string,
  env: Partial<Record<string, string | undefined>> = process.env
) {
  const requestUrl = new URL(request.url);
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
  const publicUrl = env.ABITAT_PUBLIC_URL?.trim();
  const origin =
    publicUrl && (isLocalHost(host) || isLocalHost(requestUrl.host))
      ? publicUrl
      : `${forwardedProto ?? requestUrl.protocol.replace(/:$/u, "")}://${host}`;

  return new URL(path, origin);
}

export function createBrowserRedirectUrl(request: Request, path: string) {
  const requestUrl = new URL(request.url);
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
  const origin = `${forwardedProto ?? requestUrl.protocol.replace(/:$/u, "")}://${host}`;

  return new URL(path, origin);
}

export function sanitizeRedirectPath(path: FormDataEntryValue | string | null | undefined) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    return "/";
  }

  try {
    const parsed = new URL(path, "http://abitat.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function isSecureRequest(
  request: Request,
  env: Partial<Record<string, string | undefined>> = process.env
) {
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));

  return (
    forwardedProto === "https" ||
    new URL(request.url).protocol === "https:" ||
    env.NODE_ENV === "production"
  );
}

export async function createSessionToken(
  userId: string,
  secret = getSessionSecret(),
  ttlMs = DEFAULT_SESSION_TTL_MS,
  now = Date.now()
) {
  const payload = `v2.${base64UrlString(
    JSON.stringify({
      userId,
      expiresAt: now + ttlMs
    })
  )}`;
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret = getSessionSecret(),
  now = Date.now()
): Promise<BrowserSession | false> {
  if (!token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v2") {
    return false;
  }

  const payload = `${parts[0]}.${parts[1]}`;
  const session = parseSessionPayload(parts[1]);
  if (!session) {
    return false;
  }

  const expiresAt = session.expiresAt;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  if ((await sign(payload, secret)) !== parts[2]) {
    return false;
  }

  return {
    userId: session.userId
  };
}

async function sign(payload: string, secret: string) {
  const encoder = new TextEncoder();
  const signature = hmac(sha256, encoder.encode(secret), encoder.encode(payload));
  return base64UrlBytes(signature);
}

function base64UrlString(input: string) {
  return base64UrlBytes(new TextEncoder().encode(input));
}

function base64UrlBytes(input: Uint8Array) {
  const binary = Array.from(input, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function parseSessionPayload(encoded: string) {
  try {
    const json = base64UrlToString(encoded);
    const value = JSON.parse(json) as Partial<{ expiresAt: unknown; userId: unknown }>;
    if (typeof value.userId !== "string" || value.userId.length === 0) {
      return null;
    }
    if (typeof value.expiresAt !== "number") {
      return null;
    }
    return {
      userId: value.userId,
      expiresAt: value.expiresAt
    };
  } catch {
    return null;
  }
}

function base64UrlToString(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || undefined;
}

function isLocalHost(host: string) {
  const name = host.split(":")[0]?.toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
