import { runtimeSchema } from "@abitat/shared";

import { appInfo } from "../lib/app-info";

export default function Home() {
  const mockRuntime = runtimeSchema.parse("mock");

  return (
    <main>
      <section className="workspace-shell">
        <div className="topbar">
          <div className="title-stack">
            <p className="eyebrow">{appInfo.phase}</p>
            <h1>{appInfo.name}</h1>
          </div>
          <div className="status-pill">
            <span className="status-dot" aria-hidden="true" />
            Scaffold online
          </div>
        </div>

        <div className="overview-grid">
          <article className="panel">
            <h2>Web Control Plane</h2>
            <p>Next.js is ready for the workspace dashboard, host setup, projects, and runs.</p>
            <div className="command">pnpm dev</div>
          </article>

          <article className="panel">
            <h2>Host Daemon</h2>
            <p>The local daemon starts in mock mode for Phase 0 development checks.</p>
            <div className="command">pnpm --filter host-daemon dev</div>
          </article>

          <article className="panel">
            <h2>Shared Package</h2>
            <p>@abitat/shared validates the {mockRuntime} runtime for the app and daemon.</p>
            <div className="command">pnpm --filter @abitat/shared build</div>
          </article>
        </div>
      </section>
    </main>
  );
}
