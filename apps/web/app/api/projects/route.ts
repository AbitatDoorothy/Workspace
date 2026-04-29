import { NextResponse } from "next/server";
import { z } from "zod";

import { createPublicRedirectUrl, isSecureRequest } from "../../../server/auth/session";
import { projectService } from "../../../server/projects";
import {
  PROJECT_DRAFT_COOKIE_MAX_AGE_SECONDS,
  PROJECT_DRAFT_COOKIE_NAME,
  createProjectDraft
} from "../../../server/projects/project-drafts";

const projectRequestSchema = z.object({
  workspaceId: z.string().min(1).default("workspace_demo"),
  name: z.string().min(1),
  hostLocalPath: z.string().min(1).optional(),
  createdByUserId: z.string().min(1).default("user_demo")
});

export async function POST(request: Request) {
  const isFormRequest = request.headers
    .get("content-type")
    ?.includes("application/x-www-form-urlencoded");
  let body: unknown = {};

  try {
    body = await parseRequest(request);
    const project = await projectService.createProject(projectRequestSchema.parse(body));

    if (isFormRequest) {
      return NextResponse.redirect(createPublicRedirectUrl(request, "/projects"), 303);
    }

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (isFormRequest) {
      return redirectToProjectDraft(request, body, error);
    }

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

function redirectToProjectDraft(request: Request, body: unknown, error: unknown) {
  const form = body as Partial<Record<string, unknown>>;
  const draft = createProjectDraft({
    error: error instanceof Error ? readableErrorMessage(error) : "Unable to create project",
    hostLocalPath: stringValue(form.hostLocalPath),
    name: stringValue(form.name)
  });
  const url = createPublicRedirectUrl(request, "/projects");
  url.searchParams.set("projectDraftId", draft.id);
  url.hash = "create-project-dialog";
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(PROJECT_DRAFT_COOKIE_NAME, draft.cookieValue, {
    httpOnly: true,
    maxAge: PROJECT_DRAFT_COOKIE_MAX_AGE_SECONDS,
    path: "/projects",
    sameSite: "lax",
    secure: isSecureRequest(request)
  });
  return response;
}

function readableErrorMessage(error: Error) {
  if (error.message.includes("hostLocalPath")) {
    return "Choose a local folder first.";
  }

  return error.message;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
