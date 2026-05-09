import { NextResponse } from "next/server";

import { prisma } from "../../../server/db/client";

export async function GET() {
  const publicUrl = process.env.ABITAT_PUBLIC_URL ?? "http://localhost:3000";

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      database: "ok",
      publicUrl
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        database: "error",
        publicUrl
      },
      { status: 503 }
    );
  }
}
