export type TodoStatus = "not_started" | "in_process" | "complete";

export interface TodoTask {
  id: string;
  status: TodoStatus;
  title: string;
}

export const todoStatusGridTemplateColumns = "repeat(3, minmax(240px, 1fr))";

export const todoColumns: Array<{ label: string; status: TodoStatus }> = [
  { label: "Not started", status: "not_started" },
  { label: "In process", status: "in_process" },
  { label: "Complete", status: "complete" }
];

export function addTodoTask(tasks: TodoTask[], title: string, id: string) {
  const normalizedTitle = title.trim();

  if (normalizedTitle.length === 0) {
    return tasks;
  }

  return [...tasks, { id, status: "not_started" as const, title: normalizedTitle }];
}

export function moveTodoTask(tasks: TodoTask[], taskId: string, status: TodoStatus) {
  return tasks.map((task) => (task.id === taskId ? { ...task, status } : task));
}

export function todoTasksByStatus(tasks: TodoTask[]) {
  return todoColumns.map((column) => ({
    ...column,
    tasks: tasks.filter((task) => task.status === column.status)
  }));
}

export function addSubmittedTodoTask(tasks: TodoTask[], formData: FormData, id: string) {
  return addTodoTask(tasks, submittedTodoTaskTitle(formData), id);
}

export function submittedTodoTaskTitle(formData: FormData) {
  const title = formData.get("title");

  return typeof title === "string" ? title : "";
}

export function parseStoredTodoTasks(value: string): TodoTask[] {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isTodoTask);
  } catch {
    return [];
  }
}

function isTodoTask(value: unknown): value is TodoTask {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" && typeof value.title === "string" && isTodoStatus(value.status)
  );
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === "not_started" || value === "in_process" || value === "complete";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
