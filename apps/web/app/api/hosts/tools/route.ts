import { toolScanUploadRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";

import { hostService } from "../../../../server/hosts";

export async function POST(request: Request) {
  try {
    const body = toolScanUploadRequestSchema.parse(await request.json());
    const token = getBearerToken(request);
    return NextResponse.json(await hostService.recordToolScan(body, token));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload tools" },
      { status: 401 }
    );
  }
}

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}
