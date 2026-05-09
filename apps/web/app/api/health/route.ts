import { NextResponse } from "next/server";

import { databaseConnectionSource, prisma } from "../../../server/db/client";
import {
  DEFAULT_DB_OPERATION_RETRIES,
  DEFAULT_DB_OPERATION_TIMEOUT_MS,
  retryDbOperation
} from "../../../server/db/operation";

export async function GET() {
  const publicUrl = process.env.ABITAT_PUBLIC_URL ?? "http://localhost:3000";

  try {
    await retryDbOperation("health_check_database", () => prisma.$queryRaw`SELECT 1`, {
      retries: DEFAULT_DB_OPERATION_RETRIES,
      timeoutMs: DEFAULT_DB_OPERATION_TIMEOUT_MS
    });
    return NextResponse.json({
      ok: true,
      database: "ok",
      databaseConnectionSource,
      publicUrl
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        database: "error",
        databaseConnectionSource,
        publicUrl
      },
      { status: 503 }
    );
  }
}
