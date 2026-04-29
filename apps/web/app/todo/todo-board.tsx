import type { CSSProperties } from "react";

import { Icon } from "../components/app-shell";
import {
  todoColumns,
  todoTasksByStatus,
  todoStatusGridTemplateColumns,
  type TodoTask
} from "./todo-board-model";

interface TodoBoardProps {
  tasks: TodoTask[];
}

export function TodoBoard({ tasks }: TodoBoardProps) {
  const columns = todoTasksByStatus(tasks);

  return (
    <section className="todo-board" aria-label="To-Do tasks">
      <form
        action="/api/todo/tasks"
        className="panel todo-create-form"
        method="post"
        style={createFormStyle}
      >
        <input name="intent" type="hidden" value="create" />
        <label htmlFor="todo-task-title" style={createLabelStyle}>
          New task
          <input id="todo-task-title" name="title" placeholder="Add a task" required />
        </label>
        <button type="submit">
          <Icon>add_task</Icon>
          Add task
        </button>
      </form>

      <div className="todo-status-grid" style={statusGridStyle}>
        {columns.map((column) => (
          <section
            className="todo-column"
            key={column.status}
            aria-labelledby={`${column.status}-title`}
            style={columnStyle}
          >
            <div className="todo-column-header">
              <div>
                <h2 id={`${column.status}-title`}>{column.label}</h2>
                <span>{column.tasks.length} tasks</span>
              </div>
            </div>

            <div className="todo-card-list" style={cardListStyle}>
              {column.tasks.length > 0 ? (
                column.tasks.map((task) => (
                  <article className="todo-task-card" key={task.id}>
                    <div className="todo-task-card-head">
                      <span className="avatar-disc">
                        <Icon>task_alt</Icon>
                      </span>
                      <h3>{task.title}</h3>
                    </div>

                    <form action="/api/todo/tasks" className="todo-status-form" method="post">
                      <input name="intent" type="hidden" value="update" />
                      <input name="taskId" type="hidden" value={task.id} />
                      <label>
                        Status
                        <select name="status" defaultValue={task.status}>
                          {todoColumns.map((statusOption) => (
                            <option key={statusOption.status} value={statusOption.status}>
                              {statusOption.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit">Update</button>
                    </form>
                  </article>
                ))
              ) : (
                <article className="todo-empty-card">
                  <Icon>inventory_2</Icon>
                  <p>No {column.label.toLowerCase()} tasks.</p>
                </article>
              )}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

const createFormStyle: CSSProperties = {
  alignItems: "end",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto"
};

const createLabelStyle: CSSProperties = {
  display: "grid",
  gap: 8
};

const statusGridStyle: CSSProperties = {
  alignItems: "start",
  display: "grid",
  gap: 18,
  gridTemplateColumns: todoStatusGridTemplateColumns,
  overflowX: "auto"
};

const columnStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  minWidth: 0
};

const cardListStyle: CSSProperties = {
  display: "grid",
  gap: 14
};
