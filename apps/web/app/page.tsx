import type { HostTool } from "@abitat/shared";

import { appInfo } from "../lib/app-info";
import { DEMO_PAIRING_CODE } from "../server/hosts/host-service";
import { hostService } from "../server/hosts";

export default async function Home() {
  const host = await getHost();
  const tools = Array.isArray(host?.installedToolsJson)
    ? (host.installedToolsJson as HostTool[])
    : [];

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
            Host {host?.status ?? "pending"}
          </div>
        </div>

        <div className="overview-grid">
          <article className="panel">
            <h2>Host Pairing</h2>
            <p>{DEMO_PAIRING_CODE}</p>
            <div className="command">
              pnpm --filter host-daemon dev pair --code {DEMO_PAIRING_CODE}
            </div>
          </article>

          <article className="panel">
            <h2>Host Daemon</h2>
            <p>{host?.name ?? "Demo Host"}</p>
            <div className="command">pnpm --filter host-daemon dev</div>
          </article>

          <article className="panel">
            <h2>Installed Tools</h2>
            <ul className="tool-list">
              {tools.length > 0 ? (
                tools.map((tool) => (
                  <li key={tool.name}>
                    <span>{tool.name}</span>
                    <strong>{tool.installed ? "installed" : "missing"}</strong>
                  </li>
                ))
              ) : (
                <li>
                  <span>scan</span>
                  <strong>pending</strong>
                </li>
              )}
            </ul>
          </article>

          <article className="panel">
            <h2>Projects</h2>
            <p>Workspace repository sync</p>
            <a className="button-link" href="/projects">
              Open projects
            </a>
          </article>

          <article className="panel">
            <h2>Conversations</h2>
            <p>Queued agent work</p>
            <a className="button-link" href="/conversations">
              Open conversations
            </a>
          </article>
        </div>
      </section>
    </main>
  );
}

async function getHost() {
  try {
    return await hostService.getDemoHost();
  } catch {
    return null;
  }
}
