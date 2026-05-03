import { NextResponse } from "next/server";

import { mobileService } from "../../../../server/mobile";
import { requireMobileActor } from "../../../../server/mobile/request-auth";

export async function GET(request: Request) {
  try {
    const actor = await requireMobileActor(request);
    const bootstrap = await mobileService.bootstrap(actor);

    return NextResponse.json(bootstrap);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load mobile bootstrap" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}
