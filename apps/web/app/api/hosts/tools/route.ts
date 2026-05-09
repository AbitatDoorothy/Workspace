import { toolScanUploadRequestSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";

import { isDbOperationTimeout } from "../../../../server/db/operation";
import { hostService } from "../../../../server/hosts";
import { getBearerToken } from "../../../../server/hosts/request-auth";

export async function POST(request: Request) {
  try {
    const body = toolScanUploadRequestSchema.parse(await request.json());
    const token = getBearerToken(request);
    return NextResponse.json(await hostService.recordToolScan(body, token));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to upload tools" },
      { status: isDbOperationTimeout(error) ? 503 : 401 }
    );
  }
}
