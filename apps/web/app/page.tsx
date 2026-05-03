import type { HostTool } from "@abitat/shared";

import { AppShell, Icon } from "./components/app-shell";
import { PairIphonePanel } from "./components/pair-iphone-panel";
import { appInfo } from "../lib/app-info";
import { getHostPairingCode } from "../server/hosts/host-service";
import { hostService } from "../server/hosts";

export default async function Home() {
  const host = await getHost();
  const tools = Array.isArray(host?.installedToolsJson)
    ? (host.installedToolsJson as HostTool[])
    : [];

  const installedTools = tools.filter((tool) => tool.installed);
  const pairingCode = getHostPairingCode();

  return (
    <AppShell active="dashboard">
      <section className="workspace-shell">
        <section className="glass-panel dashboard-host">
          <div className="host-title">
            <h1>Host Status</h1>
            <div className="host-name">
              <span className="status-dot" aria-hidden="true" />
              {host?.name ?? "Mac Studio"} (Local)
            </div>
            <p>
              {appInfo.name} controls coding-agent work from this paired host. Pairing code{" "}
              <strong>{pairingCode}</strong>.
            </p>
          </div>

          <div className="host-metrics">
            <div className="metric">
              <span>Host</span>
              <strong>{host?.status ?? "pending"}</strong>
            </div>
            <div className="metric">
              <span>Daemon command</span>
              <strong>pnpm dev</strong>
            </div>
          </div>
        </section>

        <div className="content-grid">
          <section>
            <div className="section-heading">
              <h2>Quick Access</h2>
            </div>

            <div className="quick-grid">
              <div className="glass-card quick-card quick-card-clickable">
                <a aria-label="Open projects" className="card-cover-link" href="/projects" />
                <div className="card-topline">
                  <span className="icon-tile">
                    <Icon>folder</Icon>
                  </span>
                  <span className="muted">Folders</span>
                </div>
                <div>
                  <h3>Projects</h3>
                  <p>Local folders on this Mac.</p>
                </div>
              </div>
              <div className="glass-card quick-card">
                <div className="card-topline">
                  <span className="icon-tile">
                    <Icon>vpn_key</Icon>
                  </span>
                  <span className="muted">{pairingCode}</span>
                </div>
                <div>
                  <h3>Host Pairing</h3>
                  <p>pnpm cloud</p>
                </div>
              </div>
            </div>
          </section>

          <aside className="dashboard-side">
            {host ? (
              <PairIphonePanel hostMachineId={host.id} workspaceId={host.workspaceId} />
            ) : null}

            <section className="glass-card health-card">
              <h2>System Health</h2>
              <div className="progress-row">
                <div>
                  <span>Installed runtimes</span>
                  <span>{installedTools.length}</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-value"
                    style={{ width: `${Math.min(100, installedTools.length * 18)}%` }}
                  />
                </div>
              </div>
              <div className="progress-row">
                <div>
                  <span>Daemon</span>
                  <span>{host?.status ?? "pending"}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-value" style={{ width: host?.status ? "82%" : "18%" }} />
                </div>
              </div>
            </section>

            <section className="glass-card tool-card">
              <h2>Installed Tools</h2>
              <ul className="tool-list">
                {tools.length > 0 ? (
                  tools.map((tool) => (
                    <li key={tool.name}>
                      <span>
                        <Icon>{tool.name === "git" ? "account_tree" : "terminal"}</Icon>
                        {tool.name}
                      </span>
                      <strong>{tool.installed ? "installed" : "missing"}</strong>
                    </li>
                  ))
                ) : (
                  <li>
                    <span>
                      <Icon>sync</Icon>
                      scan
                    </span>
                    <strong>pending</strong>
                  </li>
                )}
              </ul>
            </section>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}

async function getHost() {
  try {
    return await hostService.getDemoHost();
  } catch {
    return null;
  }
}
