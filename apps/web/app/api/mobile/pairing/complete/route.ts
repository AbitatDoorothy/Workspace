import { phonePairingCompleteRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";

import { mobileService } from "../../../../../server/mobile";

export async function POST(request: Request) {
  try {
    const input = phonePairingCompleteRequestSchema.parse(await request.json());
    const pairing = await mobileService.completePhonePairing(input);

    return NextResponse.json(pairing, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to complete phone pairing" },
      { status: 400 }
    );
  }
}
