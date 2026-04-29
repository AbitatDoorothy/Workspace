import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  addTodoTask,
  moveTodoTask,
  parseStoredTodoTasks,
  type TodoStatus,
  type TodoTask
} from "../../app/todo/todo-board-model";

interface TodoStoreOptions {
  filePath?: string;
  initialTasks?: TodoTask[];
}

export function createTodoStore({ filePath, initialTasks = [] }: TodoStoreOptions = {}) {
  let memoryTasks = [...initialTasks];

  function readTasks() {
    if (!filePath) {
      return [...memoryTasks];
    }

    if (!existsSync(filePath)) {
      return [];
    }

    return parseStoredTodoTasks(readFileSync(filePath, "utf8"));
  }

  function writeTasks(nextTasks: TodoTask[]) {
    if (!filePath) {
      memoryTasks = [...nextTasks];
      return;
    }

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(nextTasks, null, 2));
  }

  return {
    create(title: string, id = createTaskId()) {
      const tasks = addTodoTask(readTasks(), title, id);
      writeTasks(tasks);
      return tasks;
    },
    list() {
      return readTasks();
    },
    updateStatus(taskId: string, status: TodoStatus) {
      const tasks = moveTodoTask(readTasks(), taskId, status);
      writeTasks(tasks);
      return tasks;
    }
  };
}

export const todoStore = createTodoStore({
  filePath: join(process.cwd(), ".data", "todo-tasks.json")
});

function createTaskId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `task_${Date.now()}`;
}
