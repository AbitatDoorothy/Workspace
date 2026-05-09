import { NextResponse } from "next/server";

import { cliDeviceLoginService } from "../../../../../server/auth/cli-device-login-service";
import { cliDeviceLoginErrorStatus } from "../errors";

export async function POST(request: Request) {
  void request;
  try {
    return NextResponse.json(await cliDeviceLoginService.startLogin(), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start CLI login" },
      { status: cliDeviceLoginErrorStatus(error) }
    );
  }
}
