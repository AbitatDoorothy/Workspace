import { NextResponse } from "next/server";

import { createPublicRedirectUrl, isSecureRequest } from "../../../../server/auth/session";
import {
  PROJECT_DRAFT_COOKIE_MAX_AGE_SECONDS,
  PROJECT_DRAFT_COOKIE_NAME,
  createProjectDraft
} from "../../../../server/projects/project-drafts";
import {
  chooseLocalProjectFolder,
  isFolderPickerCancel
} from "../../../../server/projects/local-folder-picker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const name = stringValue(formData.get("name"));
  const existingPath = stringValue(formData.get("hostLocalPath"));

  try {
    const path = await chooseLocalProjectFolder();

    if (!path) {
      return redirectToProjectsDraft(request, { hostLocalPath: existingPath, name });
    }

    return redirectToProjectsDraft(request, { hostLocalPath: path, name });
  } catch (error) {
    if (isFolderPickerCancel(error)) {
      return redirectToProjectsDraft(request, { hostLocalPath: existingPath, name });
    }

    return redirectToProjectsDraft(request, {
      error: error instanceof Error ? error.message : "Unable to choose local folder",
      hostLocalPath: existingPath,
      name
    });
  }
}

function redirectToProjectsDraft(
  request: Request,
  draft: { error?: string; hostLocalPath?: string; name?: string }
) {
  const projectDraft = createProjectDraft(draft);
  const url = createPublicRedirectUrl(request, "/projects");
  url.searchParams.set("projectDraftId", projectDraft.id);
  url.hash = "create-project-dialog";
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(PROJECT_DRAFT_COOKIE_NAME, projectDraft.cookieValue, {
    httpOnly: true,
    maxAge: PROJECT_DRAFT_COOKIE_MAX_AGE_SECONDS,
    path: "/projects",
    sameSite: "lax",
    secure: isSecureRequest(request)
  });
  return response;
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : undefined;
}
