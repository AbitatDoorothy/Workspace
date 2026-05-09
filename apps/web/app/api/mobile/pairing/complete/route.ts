import { phonePairingCompleteRequestSchema } from "@abitat_reece/shared";
import { NextResponse } from "next/server";

import { isDbOperationTimeout } from "../../../../../server/db/operation";
import { mobileService } from "../../../../../server/mobile";
import { mobileActivityLog } from "../../../../../server/mobile/mobile-activity-log";

export async function POST(request: Request) {
  try {
    const input = phonePairingCompleteRequestSchema.parse(await request.json());
    const pairing = await mobileService.completePhonePairing(input);
    mobileActivityLog.record("mobile_pairing_completed", {
      hostMachineId: pairing.hostMachineId,
      machineId: pairing.machineId,
      workspaceId: pairing.workspaceId
    });

    return NextResponse.json(pairing, { status: 201 });
  } catch (error) {
    console.warn("mobile pairing completion failed", {
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to complete phone pairing" },
      { status: isDbOperationTimeout(error) ? 503 : 400 }
    );
  }
}
