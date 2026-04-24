import { NextResponse } from "next/server";
import { z } from "zod";

import { projectService } from "../../../server/projects";

const projectRequestSchema = z.object({
  workspaceId: z.string().min(1).default("workspace_demo"),
  name: z.string().min(1),
  repoUrl: z.string().min(1),
  defaultBranch: z.string().min(1).default("main"),
  createdByUserId: z.string().min(1).default("user_demo")
});

export async function POST(request: Request) {
  try {
    const body = await parseRequest(request);
    const project = await projectService.createProject(projectRequestSchema.parse(body));

    if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
      return NextResponse.redirect(new URL("/projects", request.url), 303);
    }

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create project" },
      { status: 400 }
    );
  }
}

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(await request.formData());
  }

  return request.json();
}
