import { hostHeartbeatRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";

import { hostService } from "../../../../server/hosts";

export async function POST(request: Request) {
  try {
    const body = hostHeartbeatRequestSchema.parse(await request.json());
    const token = getBearerToken(request);
    return NextResponse.json(await hostService.recordHeartbeat(body, token));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to record heartbeat" },
      { status: 401 }
    );
  }
}

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}
