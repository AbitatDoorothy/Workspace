import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreateProjectDialog } from "../app/projects/create-project-dialog";

describe("CreateProjectDialog", () => {
  it("opens project creation from a button and collects name plus selected folder", () => {
    const html = renderToStaticMarkup(
      createElement(CreateProjectDialog, {
        userId: "user_demo",
        workspaceId: "workspace_demo"
      })
    );

    expect(html).toContain("Create project");
    expect(html).toContain('action="/projects#create-project-dialog"');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('href="#create-project-dialog"');
    expect(html).toContain('class="create-project-overlay"');
    expect(html).toContain('id="create-project-dialog"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('action="/api/projects"');
    expect(html).toContain('name="name"');
    expect(html).toContain('name="hostLocalPath"');
    expect(html).toContain('formAction="/api/projects/local-folder"');
    expect(html).toContain("Choose folder");
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("useState");
    expect(html).not.toContain("fetch(");
    expect(html).not.toContain('name="defaultBranch"');
    expect(html).not.toContain('name="sourceType"');
    expect(html).not.toContain('name="repoUrl"');
  });

  it("keeps a selected folder and validation message inside the popup", () => {
    const html = renderToStaticMarkup(
      createElement(CreateProjectDialog, {
        draft: {
          error: "Choose a local folder first.",
          hostLocalPath: "/Users/reece/Desktop/Test",
          name: "Desktop Test"
        },
        userId: "user_demo",
        workspaceId: "workspace_demo"
      })
    );

    expect(html).toContain('value="Desktop Test"');
    expect(html).toContain('value="/Users/reece/Desktop/Test"');
    expect(html).toContain("Choose a local folder first.");
  });
});
