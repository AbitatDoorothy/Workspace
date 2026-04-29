import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  addTodoTask,
  completeTodoTaskForConversation,
  linkTodoTaskToConversation,
  moveTodoTask,
  parseStoredTodoTasks,
  startCodexTodoTask,
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
    completeConversationTask(conversationId: string) {
      const tasks = completeTodoTaskForConversation(readTasks(), conversationId);
      writeTasks(tasks);
      return tasks;
    },
    linkConversation(taskId: string, conversationId: string) {
      const tasks = linkTodoTaskToConversation(readTasks(), taskId, conversationId);
      writeTasks(tasks);
      return tasks.find((task) => task.id === taskId) ?? null;
    },
    list() {
      return readTasks();
    },
    listByStatus(status: TodoStatus) {
      return readTasks().filter((task) => task.status === status);
    },
    startCodexTask(title: string, id = createTaskId()) {
      const result = startCodexTodoTask(readTasks(), title, id);
      writeTasks(result.tasks);
      return result.task;
    },
    updateStatus(taskId: string, status: TodoStatus) {
      const tasks = moveTodoTask(readTasks(), taskId, status);
      writeTasks(tasks);
      return tasks;
    }
  };
}

export type TodoStore = ReturnType<typeof createTodoStore>;

export const todoStore = createTodoStore({
  filePath: join(process.cwd(), ".data", "todo-tasks.json")
});

function createTaskId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `task_${Date.now()}`;
}
