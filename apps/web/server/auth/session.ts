export const SESSION_COOKIE_NAME = "abitat_session";
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_LOGIN_PASSWORD = "abitat-local";
const DEFAULT_SESSION_SECRET = "local-dev-secret";

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
    env.ABITAT_PUBLIC_URL?.startsWith("https://") === true ||
    env.NODE_ENV === "production"
  );
}

export async function createSessionToken(
  secret = getSessionSecret(),
  ttlMs = DEFAULT_SESSION_TTL_MS,
  now = Date.now()
) {
  const payload = `v1.${now + ttlMs}`;
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret = getSessionSecret(),
  now = Date.now()
) {
  if (!token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return false;
  }

  const payload = `${parts[0]}.${parts[1]}`;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  return (await sign(payload, secret)) === parts[2];
}

async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64Url(signature);
}

function base64Url(input: ArrayBuffer) {
  const binary = Array.from(new Uint8Array(input), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || undefined;
}

function isLocalHost(host: string) {
  const name = host.split(":")[0]?.toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
