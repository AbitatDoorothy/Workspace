import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StartCodexDialog } from "../app/projects/[projectId]/start-codex-dialog";

describe("StartCodexDialog", () => {
  it("collects task title and type before starting Codex", () => {
    const html = renderToStaticMarkup(
      createElement(StartCodexDialog, {
        projectId: "project_demo",
        workspaceId: "workspace_demo"
      })
    );

    expect(html).toContain("Start codex");
    expect(html).toContain('href="#start-codex-dialog"');
    expect(html).toContain('href="/projects/project_demo"');
    expect(html).toContain('</div><div class="task-start-overlay" id="start-codex-dialog">');
    expect(html).not.toContain("showModal");
    expect(html).toContain('action="/api/conversations"');
    expect(html).toContain('name="prompt"');
    expect(html).toContain('required=""');
    expect(html).toContain('name="type"');
    expect(html).toContain('value="feature"');
    expect(html).toContain('value="bugfix"');
    expect(html).toContain('value="investigation"');
    expect(html).toContain('value="refactor"');
    expect(html).toContain('name="runtime"');
    expect(html).toContain('value="codex"');
    expect(html).not.toContain('name="agentId"');
  });
});
