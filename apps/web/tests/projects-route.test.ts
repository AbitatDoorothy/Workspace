import { describe, expect, it } from "vitest";

import { POST } from "../app/api/projects/route";
import { PROJECT_DRAFT_COOKIE_NAME, getProjectDraft } from "../server/projects/project-drafts";

describe("projects route", () => {
  it("keeps form validation failures in the create project popup", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/projects", {
        body: new URLSearchParams({
          createdByUserId: "user_demo",
          hostLocalPath: "",
          name: "Local Test",
          workspaceId: "workspace_demo"
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-host": "workspace.abitat.io",
          "x-forwarded-proto": "https"
        },
        method: "POST"
      })
    );

    const location = response.headers.get("location") ?? "";

    expect(response.status).toBe(303);
    expect(location).toMatch(
      /^https:\/\/workspace\.abitat\.io\/projects\?projectDraftId=project_draft_/u
    );
    expect(location).toContain("#create-project-dialog");
    const draftId = new URL(location).searchParams.get("projectDraftId") ?? undefined;
    expect(response.headers.get("set-cookie")).toContain(`${PROJECT_DRAFT_COOKIE_NAME}=`);
    const cookieValue = readCookieValue(response.headers.get("set-cookie"));
    expect(getProjectDraft(draftId, cookieValue)).toMatchObject({
      error: "Choose a local folder first.",
      name: "Local Test"
    });
  });
});

function readCookieValue(setCookie: string | null) {
  const cookie = setCookie
    ?.split(/,\s*/u)
    .find((entry) => entry.startsWith(`${PROJECT_DRAFT_COOKIE_NAME}=`));
  return cookie?.slice(PROJECT_DRAFT_COOKIE_NAME.length + 1).split(";")[0];
}
