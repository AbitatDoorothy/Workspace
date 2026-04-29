import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StartCodexDialog } from "../app/projects/[projectId]/start-codex-dialog";

describe("StartCodexDialog", () => {
  it("collects a required to-do and type before starting Codex", () => {
    const html = renderToStaticMarkup(
      createElement(StartCodexDialog, {
        projectId: "project_demo",
        todoTasks: [
          {
            id: "task_demo",
            status: "not_started",
            title: "Draft launch checklist"
          }
        ],
        workspaceId: "workspace_demo"
      })
    );

    expect(html).toContain("Start codex");
    expect(html).toContain('href="#start-codex-dialog"');
    expect(html).toContain('href="/projects/project_demo"');
    expect(html).toContain('</div><div class="task-start-overlay" id="start-codex-dialog">');
    expect(html).not.toContain("showModal");
    expect(html).toContain('action="/api/conversations"');
    expect(html).toContain("To-Do");
    expect(html).not.toContain("Task title");
    expect(html).toContain('name="todoTitle"');
    expect(html).toContain('list="start-codex-todos-project_demo"');
    expect(html).toContain('<datalist id="start-codex-todos-project_demo">');
    expect(html).toContain('value="Draft launch checklist"');
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
