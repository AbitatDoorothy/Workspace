import { NextResponse } from "next/server";
import { z } from "zod";

import { cliDeviceLoginService } from "../../../../../server/auth/cli-device-login-service";
import { cliDeviceLoginErrorStatus } from "../errors";

const requestSchema = z.object({
  deviceLoginId: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    return NextResponse.json(await cliDeviceLoginService.pollLogin(input.deviceLoginId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to poll CLI login" },
      { status: cliDeviceLoginErrorStatus(error) }
    );
  }
}
