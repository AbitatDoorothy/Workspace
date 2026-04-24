import { hostPairingRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";

import { hostService } from "../../../../server/hosts";

export async function POST(request: Request) {
  try {
    const body = hostPairingRequestSchema.parse(await request.json());
    return NextResponse.json(await hostService.pairHost(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to pair host" },
      { status: 400 }
    );
  }
}
