import { createHash, randomBytes } from "node:crypto";

import { prisma } from "../db/client";

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
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
  tokenGenerator?: () => string;
  ttlMs?: number;
}

interface CompleteLoginInput {
  code: string;
  userId: string;
}

const DEFAULT_LOGIN_TTL_MS = 10 * 60 * 1000;

export function hashCliDeviceLoginSecret(secret: string) {
  return createHash("sha256").update(secret.trim()).digest("hex");
}

export function createCliDeviceLoginService(
  db: CliDeviceLoginDb,
  options: CliDeviceLoginOptions = {}
) {
  const codeGenerator = options.codeGenerator ?? createLoginCode;
  const idGenerator =
    options.idGenerator ?? ((prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`);
  const now = options.now ?? (() => new Date());
  const tokenGenerator = options.tokenGenerator ?? (() => `cli_${randomBytes(24).toString("hex")}`);
  const ttlMs = options.ttlMs ?? DEFAULT_LOGIN_TTL_MS;

  return {
    async startLogin() {
      const createdAt = now();
      const code = codeGenerator();
      const login = await db.cliDeviceLogin.create({
        data: {
          id: idGenerator("cli_login"),
          codeHash: hashCliDeviceLoginSecret(code),
          userId: null,
          cliTokenHash: null,
          expiresAt: new Date(createdAt.getTime() + ttlMs),
          consumedAt: null,
          createdAt
        }
      });

      return {
        deviceLoginId: login.id,
        code,
        expiresAt: login.expiresAt.toISOString(),
        verificationPath: `/login?cliCode=${encodeURIComponent(code)}`
      };
    },

    async completeLogin(input: CompleteLoginInput) {
      const login = await db.cliDeviceLogin.findFirst({
        where: { codeHash: hashCliDeviceLoginSecret(input.code) }
      });
      assertActiveLogin(login, now());

      await db.cliDeviceLogin.update({
        where: { id: login.id },
        data: { userId: input.userId }
      });

      return { ok: true } as const;
    },

    async pollLogin(deviceLoginId: string) {
      const login = await db.cliDeviceLogin.findUnique({ where: { id: deviceLoginId } });
      assertActiveLogin(login, now(), { allowConsumed: true });

      if (!login.userId) {
        return { status: "pending" as const };
      }

      if (login.consumedAt) {
        return { status: "consumed" as const };
      }

      const cliToken = tokenGenerator();
      await db.cliDeviceLogin.update({
        where: { id: login.id },
        data: {
          cliTokenHash: hashCliDeviceLoginSecret(cliToken),
          consumedAt: now()
        }
      });

      return {
        status: "approved" as const,
        userId: login.userId,
        cliToken
      };
    },

    async verifyCliToken(cliToken: string) {
      const login = await db.cliDeviceLogin.findFirst({
        where: { cliTokenHash: hashCliDeviceLoginSecret(cliToken) }
      });

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
  return `ABITAT-${randomBytes(4).toString("hex").toUpperCase()}`;
}
