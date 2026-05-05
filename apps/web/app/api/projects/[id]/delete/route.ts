import { NextResponse } from "next/server";

import { createBrowserRedirectUrl } from "../../../../../server/auth/session";
import { projectService } from "../../../../../server/projects";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await projectService.deleteProject(id);

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(createBrowserRedirectUrl(request, "/projects"), 303);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete project" },
      { status: 400 }
    );
  }
}
