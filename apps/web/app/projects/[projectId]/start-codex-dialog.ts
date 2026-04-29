import { Fragment, createElement } from "react";

import type { TodoTask } from "../../todo/todo-board-model";

interface StartCodexDialogProps {
  projectId: string;
  todoTasks?: TodoTask[];
  workspaceId: string;
  userId?: string;
}

const conversationTypes = [
  { label: "Feature", value: "feature" },
  { label: "Bugfix", value: "bugfix" },
  { label: "Investigation", value: "investigation" },
  { label: "Refactor", value: "refactor" }
];

export function StartCodexDialog({
  projectId,
  todoTasks = [],
  workspaceId,
  userId = "user_demo"
}: StartCodexDialogProps) {
  const projectPath = `/projects/${projectId}`;
  const todoListId = `start-codex-todos-${projectId}`;

  return createElement(
    Fragment,
    null,
    createElement(
      "div",
      { className: "start-codex-control" },
      createElement(
        "a",
        {
          className: "primary-button",
          href: "#start-codex-dialog"
        },
        createElement(StartCodexIcon, null, "terminal"),
        "Start codex"
      )
    ),
    createElement(
      "div",
      {
        className: "task-start-overlay",
        id: "start-codex-dialog"
      },
      createElement(
        "section",
        {
          "aria-labelledby": "start-codex-title",
          className: "task-start-dialog",
          role: "dialog"
        },
        createElement(
          "div",
          { className: "task-dialog-header" },
          createElement("h2", { id: "start-codex-title" }, "Start codex"),
          createElement(
            "a",
            {
              "aria-label": "Close",
              className: "icon-button",
              href: projectPath
            },
            createElement(StartCodexIcon, null, "close")
          )
        ),
        createElement(
          "form",
          {
            action: "/api/conversations",
            className: "task-start-form",
            method: "post"
          },
          createElement("input", { name: "workspaceId", type: "hidden", value: workspaceId }),
          createElement("input", { name: "projectId", type: "hidden", value: projectId }),
          createElement("input", { name: "createdByUserId", type: "hidden", value: userId }),
          createElement("input", { name: "runtime", type: "hidden", value: "codex" }),
          createElement("input", {
            name: "redirectTo",
            type: "hidden",
            value: `/projects/${projectId}`
          }),
          createElement(
            "label",
            null,
            "To-Do",
            createElement("input", {
              autoFocus: true,
              list: todoListId,
              name: "todoTitle",
              placeholder: "Choose or type a to-do",
              required: true
            }),
            createElement(
              "datalist",
              { id: todoListId },
              todoTasks.map((task) =>
                createElement("option", { key: task.id, value: task.title }, task.title)
              )
            )
          ),
          createElement(
            "label",
            null,
            "Task type",
            createElement(
              "select",
              { defaultValue: "feature", name: "type" },
              conversationTypes.map((type) =>
                createElement("option", { key: type.value, value: type.value }, type.label)
              )
            )
          ),
          createElement(
            "div",
            { className: "task-dialog-actions" },
            createElement("a", { className: "ghost-button", href: projectPath }, "Cancel"),
            createElement(
              "button",
              { className: "primary-button", type: "submit" },
              createElement(StartCodexIcon, null, "terminal"),
              "Start codex"
            )
          )
        )
      )
    )
  );
}

function StartCodexIcon({ children }: { children: string }) {
  return createElement(
    "span",
    {
      "aria-hidden": true,
      className: "material-symbols-outlined",
      style: { fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }
    },
    children
  );
}
