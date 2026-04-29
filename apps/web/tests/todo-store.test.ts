import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTodoStore } from "../server/todos/todo-store";

describe("todo store", () => {
  it("creates tasks under not started", () => {
    const store = createTodoStore();

    expect(store.create("Write dashboard notes", "task_demo")).toEqual([
      {
        id: "task_demo",
        status: "not_started",
        title: "Write dashboard notes"
      }
    ]);
  });

  it("moves tasks to another status", () => {
    const store = createTodoStore();
    store.create("Write dashboard notes", "task_demo");

    expect(store.updateStatus("task_demo", "in_process")).toEqual([
      {
        id: "task_demo",
        status: "in_process",
        title: "Write dashboard notes"
      }
    ]);
  });

  it("persists tasks across store instances when backed by a file", () => {
    const filePath = join(mkdtempSync(join(tmpdir(), "abitat-todo-")), "tasks.json");
    const firstStore = createTodoStore({ filePath });
    firstStore.create("Write dashboard notes", "task_demo");

    const secondStore = createTodoStore({ filePath });

    expect(secondStore.list()).toEqual([
      {
        id: "task_demo",
        status: "not_started",
        title: "Write dashboard notes"
      }
    ]);
  });
});
