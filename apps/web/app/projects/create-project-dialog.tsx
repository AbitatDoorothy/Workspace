import { Fragment, createElement } from "react";

interface CreateProjectDialogProps {
  draft?: {
    error?: string;
    hostLocalPath?: string;
    name?: string;
  };
  workspaceId: string;
  userId?: string;
}

export function CreateProjectDialog({
  draft,
  workspaceId,
  userId = "user_demo"
}: CreateProjectDialogProps) {
  const folderPath = draft?.hostLocalPath ?? "";
  const projectName = draft?.name ?? "";

  return createElement(
    Fragment,
    null,
    createElement(
      "form",
      {
        action: "/projects#create-project-dialog",
        method: "get"
      },
      createElement(
        "button",
        {
          className: "primary-button create-project-button",
          type: "submit"
        },
        createElement(ProjectDialogIcon, null, "add"),
        "Create project"
      )
    ),
    createElement(
      "div",
      {
        "aria-labelledby": "create-project-title",
        className: "create-project-overlay",
        id: "create-project-dialog"
      },
      createElement(
        "section",
        {
          "aria-labelledby": "create-project-title",
          className: "create-project-dialog",
          role: "dialog"
        },
        createElement(
          "div",
          { className: "task-dialog-header" },
          createElement("h2", { id: "create-project-title" }, "Create project"),
          createElement(
            "a",
            {
              "aria-label": "Close",
              className: "icon-button",
              href: "/projects"
            },
            createElement(ProjectDialogIcon, null, "close")
          )
        ),
        createElement(
          "form",
          {
            action: "/api/projects",
            className: "task-start-form",
            method: "post"
          },
          createElement("input", { name: "workspaceId", type: "hidden", value: workspaceId }),
          createElement("input", { name: "createdByUserId", type: "hidden", value: userId }),
          createElement("input", { name: "hostLocalPath", type: "hidden", value: folderPath }),
          createElement(
            "label",
            null,
            "Name",
            createElement("input", {
              autoFocus: true,
              defaultValue: projectName,
              name: "name",
              required: true
            })
          ),
          createElement(
            "div",
            { className: "folder-picker-field" },
            createElement("label", { htmlFor: "project-folder-path" }, "Local folder"),
            createElement(
              "div",
              { className: "folder-picker-row" },
              createElement("input", {
                id: "project-folder-path",
                placeholder: "No folder selected",
                readOnly: true,
                value: folderPath
              }),
              createElement(
                "button",
                {
                  className: "ghost-button",
                  formAction: "/api/projects/local-folder",
                  formMethod: "post",
                  formNoValidate: true,
                  type: "submit"
                },
                createElement(ProjectDialogIcon, null, "folder_open"),
                "Choose folder"
              )
            )
          ),
          draft?.error ? createElement("p", { className: "form-error" }, draft.error) : null,
          createElement(
            "div",
            { className: "task-dialog-actions" },
            createElement("a", { className: "ghost-button", href: "/projects" }, "Cancel"),
            createElement(
              "button",
              { className: "primary-button", type: "submit" },
              createElement(ProjectDialogIcon, null, "add"),
              "Create project"
            )
          )
        )
      )
    )
  );
}

function ProjectDialogIcon({ children }: { children: string }) {
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
