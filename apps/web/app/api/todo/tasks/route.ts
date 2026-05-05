import { NextResponse } from "next/server";

import { createBrowserRedirectUrl } from "../../../../server/auth/session";
import { todoStore } from "../../../../server/todos";
import { submittedTodoTaskTitle, type TodoStatus } from "../../../todo/todo-board-model";

export async function POST(request: Request) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    todoStore.create(submittedTodoTaskTitle(formData));
  }

  if (intent === "update") {
    const taskId = formData.get("taskId");
    const status = todoStatusFromFormData(formData);

    if (typeof taskId === "string" && status) {
      todoStore.updateStatus(taskId, status);
    }
  }

  return NextResponse.redirect(createBrowserRedirectUrl(request, "/todo"), 303);
}

function todoStatusFromFormData(formData: FormData): TodoStatus | null {
  const status = formData.get("status");

  if (status === "not_started" || status === "in_process" || status === "complete") {
    return status;
  }

  return null;
}
