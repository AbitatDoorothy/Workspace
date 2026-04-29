import { describe, expect, it } from "vitest";

import {
  addTodoTask,
  addSubmittedTodoTask,
  moveTodoTask,
  submittedTodoTaskTitle,
  todoColumns,
  todoTasksByStatus,
  todoStatusGridTemplateColumns,
  type TodoTask
} from "../app/todo/todo-board-model";

describe("todo board model", () => {
  it("creates new tasks in not started", () => {
    const tasks = addTodoTask([], "  Draft launch checklist  ", "task_demo");

    expect(tasks).toEqual([
      {
        id: "task_demo",
        status: "not_started",
        title: "Draft launch checklist"
      }
    ]);
  });

  it("moves tasks between in process and complete", () => {
    const tasks: TodoTask[] = [
      { id: "task_demo", status: "not_started", title: "Draft launch checklist" }
    ];

    expect(moveTodoTask(tasks, "task_demo", "in_process")).toEqual([
      { id: "task_demo", status: "in_process", title: "Draft launch checklist" }
    ]);
    expect(moveTodoTask(tasks, "task_demo", "complete")).toEqual([
      { id: "task_demo", status: "complete", title: "Draft launch checklist" }
    ]);
  });

  it("groups tasks under the three visible statuses", () => {
    const tasks: TodoTask[] = [
      { id: "task_1", status: "not_started", title: "Plan" },
      { id: "task_2", status: "in_process", title: "Build" },
      { id: "task_3", status: "complete", title: "Review" }
    ];

    expect(todoColumns.map((column) => column.label)).toEqual([
      "Not started",
      "In process",
      "Complete"
    ]);
    expect(
      todoTasksByStatus(tasks).map((column) => column.tasks.map((task) => task.title))
    ).toEqual([["Plan"], ["Build"], ["Review"]]);
  });

  it("ignores empty task titles", () => {
    const tasks: TodoTask[] = [
      { id: "task_demo", status: "not_started", title: "Draft launch checklist" }
    ];

    expect(addTodoTask(tasks, "   ", "task_empty")).toBe(tasks);
  });

  it("reads the task title from submitted form data", () => {
    const formData = new FormData();
    formData.set("title", "Write dashboard notes");

    expect(submittedTodoTaskTitle(formData)).toBe("Write dashboard notes");
  });

  it("creates submitted form tasks under not started", () => {
    const formData = new FormData();
    formData.set("title", "Write dashboard notes");

    expect(addSubmittedTodoTask([], formData, "task_submitted")).toEqual([
      {
        id: "task_submitted",
        status: "not_started",
        title: "Write dashboard notes"
      }
    ]);
  });

  it("keeps the three statuses arranged as horizontal columns", () => {
    expect(todoStatusGridTemplateColumns).toBe("repeat(3, minmax(240px, 1fr))");
  });
});
