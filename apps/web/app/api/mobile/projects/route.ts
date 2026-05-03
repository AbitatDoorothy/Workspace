import { NextResponse } from "next/server";

import { mobileService } from "../../../../server/mobile";
import { requireMobileActor } from "../../../../server/mobile/request-auth";

export async function GET(request: Request) {
  try {
    const actor = await requireMobileActor(request);
    const projects = await mobileService.listProjects(actor);

    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list mobile projects" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}
