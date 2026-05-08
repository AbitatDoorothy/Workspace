import { NextResponse } from "next/server";
import { z } from "zod";

import { cliDeviceLoginService } from "../../../../../server/auth/cli-device-login-service";
import { getRequestSessionUserId } from "../../../../../server/auth/request-session";

const requestSchema = z.object({
  code: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const userId = await getRequestSessionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const input = requestSchema.parse(await request.json());
    return NextResponse.json(await cliDeviceLoginService.completeLogin({ ...input, userId }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to complete CLI login" },
      { status: 400 }
    );
  }
}
