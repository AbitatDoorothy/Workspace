import { phonePairingStartRequestSchema } from "@abitat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { mobileService } from "../../../../../server/mobile";

const requestSchema = phonePairingStartRequestSchema.extend({
  createdByUserId: z.string().min(1).default("user_demo")
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const pairing = await mobileService.createPhonePairing(input);

    return NextResponse.json(pairing, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start phone pairing" },
      { status: 400 }
    );
  }
}
