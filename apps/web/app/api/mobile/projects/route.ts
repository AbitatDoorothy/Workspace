import { NextResponse } from "next/server";

import { codexAppService } from "../../../../server/codex-app";
import { mobileService } from "../../../../server/mobile";
import { requireMobileActor } from "../../../../server/mobile/request-auth";

export async function GET(request: Request) {
  try {
    const actor = await requireMobileActor(request);
    const [localProjects, codexProjects] = await Promise.allSettled([
      mobileService.listProjects(actor),
      codexAppService.listProjects()
    ]);

    return NextResponse.json({
      projects: [
        ...(codexProjects.status === "fulfilled" ? codexProjects.value : []),
        ...(localProjects.status === "fulfilled" ? localProjects.value : [])
      ]
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to list mobile projects" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}
