import "pg-cloudflare";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://reece@localhost:5432/abitat_workspace";
const adapter = new PrismaPg(
  {
    allowExitOnIdle: true,
    connectionString,
    connectionTimeoutMillis: parsePositiveInt(process.env.DATABASE_POOL_CONNECT_TIMEOUT_MS, 5000),
    idleTimeoutMillis: parsePositiveInt(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS, 1000),
    lock_timeout: parsePositiveInt(process.env.DATABASE_POOL_LOCK_TIMEOUT_MS, 5000),
    max: parsePositiveInt(process.env.DATABASE_POOL_MAX, 5),
    query_timeout: parsePositiveInt(process.env.DATABASE_POOL_QUERY_TIMEOUT_MS, 5000),
    statement_timeout: parsePositiveInt(process.env.DATABASE_POOL_STATEMENT_TIMEOUT_MS, 5000)
  },
  {
    onConnectionError(error) {
      console.warn("postgres connection error", { message: error.message });
    },
    onPoolError(error) {
      console.warn("postgres pool error", { message: error.message });
    }
  }
);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
