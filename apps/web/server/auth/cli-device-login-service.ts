import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";

import { randomHex, randomId, sha256Hex } from "../crypto";
import { prisma } from "../db/client";
import {
  DB_OPERATION_TIMEOUT_ERROR_NAME,
  isDbOperationTimeout,
  retryDbOperation
} from "../db/operation";
import { getSessionSecret } from "./session";

interface CliDeviceLoginRecord {
  id: string;
  codeHash: string;
  userId?: string | null;
  cliTokenHash?: string | null;
  expiresAt: Date;
  consumedAt?: Date | null;
  createdAt: Date;
}

interface CliDeviceLoginDb {
  cliDeviceLogin: {
    create(args: { data: CliDeviceLoginRecord }): Promise<CliDeviceLoginRecord>;
    findFirst(args: { where: Partial<CliDeviceLoginRecord> }): Promise<CliDeviceLoginRecord | null>;
    findUnique(args: { where: { id: string } }): Promise<CliDeviceLoginRecord | null>;
    update(args: {
      data: Partial<CliDeviceLoginRecord>;
      where: { id: string };
    }): Promise<CliDeviceLoginRecord>;
  };
}

interface CliDeviceLoginOptions {
  codeGenerator?: () => string;
  dbOperationRetries?: number;
  dbOperationTimeoutMs?: number;
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
  tokenGenerator?: (actor: CliTokenActor, issuedAt: Date) => string;
  tokenSecret?: string;
  tokenTtlMs?: number;
  ttlMs?: number;
}

interface CompleteLoginInput {
  code: string;
  userId: string;
  workspaceId?: string;
}

interface SignedCliDeviceLoginPayload {
  expiresAt: number;
  loginId: string;
  nonce: string;
}

interface CliDeviceLoginApproval {
  cliToken: string;
  userId: string;
  workspaceId?: string;
}

export interface CliTokenActor {
  userId: string;
  workspaceId?: string;
}

const DEFAULT_LOGIN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLI_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SIGNED_CLI_TOKEN_PREFIX = "cli_v2_";
const SIGNED_CLI_DEVICE_LOGIN_CODE_PREFIX = "cli_code_v2_";
const SIGNED_CLI_DEVICE_LOGIN_ID_PREFIX = "cli_login_v2_";
export const CLI_DEVICE_LOGIN_DB_TIMEOUT_ERROR_NAME = DB_OPERATION_TIMEOUT_ERROR_NAME;

export function hashCliDeviceLoginSecret(secret: string) {
  return sha256Hex(secret.trim());
}

export function createCliDeviceLoginService(
  db: CliDeviceLoginDb,
  options: CliDeviceLoginOptions = {}
) {
  const codeGenerator = options.codeGenerator ?? createLoginCode;
  const idGenerator = options.idGenerator ?? ((prefix: string) => randomId(prefix));
  const now = options.now ?? (() => new Date());
  const tokenSecret = options.tokenSecret ?? getSessionSecret();
  const tokenTtlMs = options.tokenTtlMs ?? DEFAULT_CLI_TOKEN_TTL_MS;
  const tokenGenerator =
    options.tokenGenerator ??
    ((actor: CliTokenActor, issuedAt: Date) =>
      createSignedCliToken(actor, tokenSecret, tokenTtlMs, issuedAt.getTime()));
  const ttlMs = options.ttlMs ?? DEFAULT_LOGIN_TTL_MS;
  const dbOperationRetries = options.dbOperationRetries ?? 2;
  const dbOperationTimeoutMs = options.dbOperationTimeoutMs ?? 5000;

  return {
    async startLogin() {
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + ttlMs);
      const payload = {
        expiresAt: expiresAt.getTime(),
        loginId: idGenerator("cli_login"),
        nonce: codeGenerator()
      };
      const signedPayload = createSignedCliDeviceLoginPayload(payload, tokenSecret, "code");
      const signedDeviceLoginPayload = createSignedCliDeviceLoginPayload(
        payload,
        tokenSecret,
        "id"
      );
      const code = `${SIGNED_CLI_DEVICE_LOGIN_CODE_PREFIX}${signedPayload}`;

      return {
        deviceLoginId: `${SIGNED_CLI_DEVICE_LOGIN_ID_PREFIX}${signedDeviceLoginPayload}`,
        code,
        expiresAt: expiresAt.toISOString(),
        verificationPath: `/login?cliCode=${encodeURIComponent(code)}`
      };
    },

    async completeLogin(input: CompleteLoginInput) {
      const completedAt = now();
      const signedLogin = verifySignedCliDeviceLoginCode(
        input.code,
        tokenSecret,
        completedAt.getTime()
      );
      if (signedLogin) {
        const actor = { userId: input.userId, workspaceId: input.workspaceId };
        const cliToken = tokenGenerator(actor, completedAt);
        await storeCliDeviceLoginApproval(
          signedLogin.deviceLoginId,
          {
            cliToken,
            userId: input.userId,
            workspaceId: input.workspaceId
          },
          signedLogin.expiresAt
        );

        void retryDbOperation(
          "cli_device_login_complete_record",
          () =>
            db.cliDeviceLogin.create({
              data: {
                id: signedLogin.deviceLoginId,
                codeHash: hashCliDeviceLoginSecret(input.code),
                userId: input.userId,
                cliTokenHash: hashCliDeviceLoginSecret(cliToken),
                expiresAt: signedLogin.expiresAt,
                consumedAt: null,
                createdAt: completedAt
              }
            }),
          {
            retries: dbOperationRetries,
            timeoutMs: dbOperationTimeoutMs
          }
        ).catch((error: unknown) => {
          console.warn("cli device login record skipped", {
            message: error instanceof Error ? error.message : String(error)
          });
        });

        return { ok: true } as const;
      }

      const login = await retryDbOperation(
        "cli_device_login_complete_find",
        () =>
          db.cliDeviceLogin.findFirst({
            where: { codeHash: hashCliDeviceLoginSecret(input.code) }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
      if (!login) {
        throw new Error("Invalid CLI login code");
      }

      assertActiveLogin(login, completedAt);

      await retryDbOperation(
        "cli_device_login_complete_update",
        () =>
          db.cliDeviceLogin.update({
            where: { id: login.id },
            data: { userId: input.userId }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );

      return { ok: true } as const;
    },

    async pollLogin(deviceLoginId: string) {
      const polledAt = now();
      const signedLogin = verifySignedCliDeviceLoginId(
        deviceLoginId,
        tokenSecret,
        polledAt.getTime()
      );
      const cachedApproval = signedLogin
        ? await readCliDeviceLoginApproval(deviceLoginId, polledAt.getTime())
        : null;
      if (cachedApproval) {
        return {
          status: "approved" as const,
          userId: cachedApproval.userId,
          cliToken: cachedApproval.cliToken
        };
      }

      let login: CliDeviceLoginRecord | null;
      try {
        login = await retryDbOperation(
          "cli_device_login_poll_find",
          () => db.cliDeviceLogin.findUnique({ where: { id: deviceLoginId } }),
          {
            retries: dbOperationRetries,
            timeoutMs: dbOperationTimeoutMs
          }
        );
      } catch (error) {
        if (signedLogin && isDbOperationTimeout(error)) {
          return { status: "pending" as const };
        }
        throw error;
      }
      if (!login) {
        if (signedLogin) {
          return { status: "pending" as const };
        }
        throw new Error("Invalid CLI login code");
      }
      assertActiveLogin(login, polledAt, { allowConsumed: true });

      if (!login.userId) {
        return { status: "pending" as const };
      }

      if (login.consumedAt) {
        return { status: "consumed" as const };
      }

      const consumedAt = now();
      const cliToken = tokenGenerator({ userId: login.userId }, consumedAt);
      await retryDbOperation(
        "cli_device_login_poll_update",
        () =>
          db.cliDeviceLogin.update({
            where: { id: login.id },
            data: {
              cliTokenHash: hashCliDeviceLoginSecret(cliToken),
              consumedAt
            }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );

      return {
        status: "approved" as const,
        userId: login.userId,
        cliToken
      };
    },

    async verifyCliToken(cliToken: string) {
      const signedActor = verifySignedCliToken(cliToken, tokenSecret, now().getTime());
      if (signedActor) {
        return signedActor;
      }
      if (cliToken.startsWith(SIGNED_CLI_TOKEN_PREFIX)) {
        return null;
      }

      const login = await retryDbOperation(
        "cli_device_login_verify_token",
        () =>
          db.cliDeviceLogin.findFirst({
            where: { cliTokenHash: hashCliDeviceLoginSecret(cliToken) }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );

      return login?.userId ? { userId: login.userId } : null;
    }
  };
}

export const cliDeviceLoginService = createCliDeviceLoginService(
  createPrismaCliDeviceLoginDb(prisma)
);

function createPrismaCliDeviceLoginDb(db: typeof prisma): CliDeviceLoginDb {
  return {
    cliDeviceLogin: {
      create(args) {
        return db.cliDeviceLogin.create({ data: args.data });
      },
      findFirst(args) {
        return db.cliDeviceLogin.findFirst({ where: args.where });
      },
      findUnique(args) {
        return db.cliDeviceLogin.findUnique(args);
      },
      update(args) {
        return db.cliDeviceLogin.update(args);
      }
    }
  };
}

function assertActiveLogin(
  login: CliDeviceLoginRecord | null,
  now: Date,
  options: { allowConsumed?: boolean } = {}
): asserts login is CliDeviceLoginRecord {
  if (!login) {
    throw new Error("Invalid CLI login code");
  }

  if (login.expiresAt.getTime() <= now.getTime()) {
    throw new Error("CLI login code has expired");
  }

  if (!options.allowConsumed && login.consumedAt) {
    throw new Error("CLI login code has already been used");
  }
}

function createLoginCode() {
  return `ABITAT-${randomHex(4).toUpperCase()}`;
}

const cliDeviceLoginApprovals = new Map<
  string,
  { approval: CliDeviceLoginApproval; expiresAtMs: number }
>();

function createSignedCliDeviceLoginPayload(
  payload: SignedCliDeviceLoginPayload,
  secret: string,
  purpose: "code" | "id"
) {
  const encoded = base64UrlString(JSON.stringify(payload));
  const signature = signCliTokenPayload(`${purpose}.${encoded}`, secret);
  return `${encoded}.${signature}`;
}

function verifySignedCliDeviceLoginCode(code: string, secret: string, nowMs: number) {
  if (!code.startsWith(SIGNED_CLI_DEVICE_LOGIN_CODE_PREFIX)) {
    return null;
  }

  const signedPayload = code.slice(SIGNED_CLI_DEVICE_LOGIN_CODE_PREFIX.length);
  const verified = verifySignedCliDeviceLoginPayload(signedPayload, secret, nowMs, "code");
  if (!verified) {
    return null;
  }

  return {
    deviceLoginId: `${SIGNED_CLI_DEVICE_LOGIN_ID_PREFIX}${createSignedCliDeviceLoginPayload(
      verified.payload,
      secret,
      "id"
    )}`,
    expiresAt: verified.expiresAt
  };
}

function verifySignedCliDeviceLoginId(deviceLoginId: string, secret: string, nowMs: number) {
  if (!deviceLoginId.startsWith(SIGNED_CLI_DEVICE_LOGIN_ID_PREFIX)) {
    return null;
  }

  const signedPayload = deviceLoginId.slice(SIGNED_CLI_DEVICE_LOGIN_ID_PREFIX.length);
  const verified = verifySignedCliDeviceLoginPayload(signedPayload, secret, nowMs, "id");
  return verified
    ? {
        deviceLoginId,
        expiresAt: verified.expiresAt
      }
    : null;
}

function verifySignedCliDeviceLoginPayload(
  signedPayload: string,
  secret: string,
  nowMs: number,
  purpose: "code" | "id"
) {
  const parts = signedPayload.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payload, signature] = parts;
  if (signCliTokenPayload(`${purpose}.${payload}`, secret) !== signature) {
    return null;
  }

  try {
    const decoded = JSON.parse(base64UrlToString(payload)) as Partial<SignedCliDeviceLoginPayload>;
    if (typeof decoded.loginId !== "string" || !decoded.loginId) {
      return null;
    }
    if (typeof decoded.nonce !== "string" || !decoded.nonce) {
      return null;
    }
    if (typeof decoded.expiresAt !== "number" || decoded.expiresAt <= nowMs) {
      return null;
    }

    return {
      expiresAt: new Date(decoded.expiresAt),
      payload: {
        expiresAt: decoded.expiresAt,
        loginId: decoded.loginId,
        nonce: decoded.nonce
      }
    };
  } catch {
    return null;
  }
}

async function storeCliDeviceLoginApproval(
  deviceLoginId: string,
  approval: CliDeviceLoginApproval,
  expiresAt: Date
) {
  const expiresAtMs = expiresAt.getTime();
  cliDeviceLoginApprovals.set(deviceLoginId, { approval, expiresAtMs });

  const cache = defaultCache();
  if (!cache) {
    return;
  }

  await cache
    .put(
      cliApprovalCacheRequest(deviceLoginId),
      Response.json(approval, {
        headers: {
          "cache-control": `max-age=${Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000))}`
        }
      })
    )
    .catch((error: unknown) => {
      console.warn("cli device login approval cache write failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
}

async function readCliDeviceLoginApproval(deviceLoginId: string, nowMs: number) {
  const memoryApproval = cliDeviceLoginApprovals.get(deviceLoginId);
  if (memoryApproval) {
    if (memoryApproval.expiresAtMs > nowMs) {
      return memoryApproval.approval;
    }
    cliDeviceLoginApprovals.delete(deviceLoginId);
  }

  const cache = defaultCache();
  if (!cache) {
    return null;
  }

  const response = await cache.match(cliApprovalCacheRequest(deviceLoginId)).catch(() => null);
  if (!response?.ok) {
    return null;
  }

  try {
    const approval = (await response.json()) as Partial<CliDeviceLoginApproval>;
    return typeof approval.userId === "string" && typeof approval.cliToken === "string"
      ? { userId: approval.userId, workspaceId: approval.workspaceId, cliToken: approval.cliToken }
      : null;
  } catch {
    return null;
  }
}

function cliApprovalCacheRequest(deviceLoginId: string) {
  return new Request(`https://abitat.internal/cli-device-login/${sha256Hex(deviceLoginId)}`);
}

function defaultCache() {
  if (typeof caches === "undefined") {
    return null;
  }

  return (caches as CacheStorage & { default?: Cache }).default ?? null;
}

function createSignedCliToken(actor: CliTokenActor, secret: string, ttlMs: number, nowMs: number) {
  const payload = base64UrlString(
    JSON.stringify({
      expiresAt: nowMs + ttlMs,
      userId: actor.userId,
      workspaceId: actor.workspaceId
    })
  );
  const signature = signCliTokenPayload(payload, secret);
  return `${SIGNED_CLI_TOKEN_PREFIX}${payload}.${signature}`;
}

function verifySignedCliToken(token: string, secret: string, nowMs: number) {
  if (!token.startsWith(SIGNED_CLI_TOKEN_PREFIX)) {
    return null;
  }

  const rest = token.slice(SIGNED_CLI_TOKEN_PREFIX.length);
  const parts = rest.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payload, signature] = parts;
  if (signCliTokenPayload(payload, secret) !== signature) {
    return null;
  }

  try {
    const decoded = JSON.parse(base64UrlToString(payload)) as Partial<{
      expiresAt: unknown;
      userId: unknown;
      workspaceId: unknown;
    }>;
    if (typeof decoded.userId !== "string" || !decoded.userId) {
      return null;
    }
    if (decoded.workspaceId !== undefined && typeof decoded.workspaceId !== "string") {
      return null;
    }
    if (typeof decoded.expiresAt !== "number" || decoded.expiresAt <= nowMs) {
      return null;
    }
    return { userId: decoded.userId, workspaceId: decoded.workspaceId };
  } catch {
    return null;
  }
}

function signCliTokenPayload(payload: string, secret: string) {
  const encoder = new TextEncoder();
  return base64UrlBytes(hmac(sha256, encoder.encode(secret), encoder.encode(payload)));
}

function base64UrlString(input: string) {
  return base64UrlBytes(new TextEncoder().encode(input));
}

function base64UrlBytes(input: Uint8Array) {
  const binary = Array.from(input, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToString(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
