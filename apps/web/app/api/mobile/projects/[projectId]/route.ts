import { NextResponse } from "next/server";

import { mobileService } from "../../../../../server/mobile";
import { requireMobileActor } from "../../../../../server/mobile/request-auth";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const [{ projectId }, actor] = await Promise.all([context.params, requireMobileActor(request)]);
    const projects = await mobileService.listProjects(actor);
    const project = projects.find((candidate) => candidate.id === projectId);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load mobile project" },
      { status: error instanceof Error && error.message === "Invalid mobile token" ? 401 : 400 }
    );
  }
}
