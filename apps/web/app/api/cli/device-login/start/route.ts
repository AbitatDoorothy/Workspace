import { NextResponse } from "next/server";

import { cliDeviceLoginService } from "../../../../../server/auth/cli-device-login-service";

export async function POST(request: Request) {
  void request;
  return NextResponse.json(await cliDeviceLoginService.startLogin(), { status: 201 });
}
