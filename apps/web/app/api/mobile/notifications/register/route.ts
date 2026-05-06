import { NextResponse } from "next/server";
import { z } from "zod";

import { mobileService } from "../../../../../server/mobile";
import { requireMobileActor } from "../../../../../server/mobile/request-auth";

const registerPushTokenSchema = z.object({
  platform: z.literal("ios"),
  provider: z.literal("expo"),
  token: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const [actor, input] = await Promise.all([
      requireMobileActor(request),
      registerPushTokenSchema.parseAsync(await request.json())
    ]);
    const subscription = await mobileService.registerPushToken(actor, input);
    console.info(
      `[mobile-push] Registered ${subscription.provider} push token for phone ${actor.machineId} paired to host ${actor.hostMachineId ?? "unknown"}.`
    );

    return NextResponse.json({ subscription });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to register push token" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}
