import { AppShell } from "../components/app-shell";
import { todoStore } from "../../server/todos/todo-store";
import { TodoBoard } from "./todo-board";

export default function TodoPage() {
  return (
    <AppShell active="todo">
      <section className="workspace-shell compact-shell">
        <div className="page-header">
          <div className="title-stack">
            <p className="eyebrow">To-Do</p>
            <h1>Task Board</h1>
            <p>Create tasks, then move each card through not started, in process, and complete.</p>
          </div>
        </div>

        <TodoBoard tasks={todoStore.list()} />
      </section>
    </AppShell>
  );
}
