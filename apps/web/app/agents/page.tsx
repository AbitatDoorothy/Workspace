import type { HostTool } from "@abitat/shared";

import { AppShell, Icon } from "../components/app-shell";
import { agentService } from "../../server/agents";
import {
  preferredRuntimeFromTools,
  runtimeAvailabilityWarning
} from "../../server/agents/agent-service";
import { hostService } from "../../server/hosts";
import { projectService } from "../../server/projects";

export default async function AgentsPage() {
  const [agents, hostTools, projects] = await Promise.all([
    getAgents(),
    getHostTools(),
    getProjects()
  ]);
  const firstProjectId = projects[0]?.id ?? "project_demo";
  const preferredRuntime = preferredRuntimeFromTools(hostTools);
  const defaultAgentName =
    preferredRuntime === "claude"
      ? "Claude Agent"
      : preferredRuntime === "codex"
        ? "Codex Agent"
        : "Mock Agent";
  const defaultModel =
    preferredRuntime === "claude" ? "sonnet" : preferredRuntime === "codex" ? "5.4" : "mock-model";
  const defaultInstructions =
    preferredRuntime === "mock"
      ? "Use the mock runtime and keep changes small."
      : "Use the local terminal runtime and keep changes small.";

  return (
    <AppShell active="agents">
      <section className="workspace-shell compact-shell">
        <header className="agents-header">
          <div className="tabs">
            <h1>Agents</h1>
            <a className="tab tab-active" href="/agents">
              All Agents
            </a>
            <a className="tab" href="/agents">
              Active
            </a>
            <a className="tab" href="/agents">
              Drafts
            </a>
          </div>
          <div className="nav-actions">
            <input className="search-input" placeholder="Search agents..." type="search" />
            <a className="button-link" href="/conversations">
              <Icon>slow_motion_video</Icon>
              Queue
            </a>
          </div>
        </header>

        <div className="toolbar">
          <div className="filter-pills">
            <span className="pill pill-active">
              <span className="status-dot" aria-hidden="true" />
              Active
            </span>
            <span className="pill">Claude Models</span>
            <span className="pill">GPT Models</span>
            <span className="pill">
              <Icon>tune</Icon>
            </span>
          </div>
          <span className="muted">Sort by: Recently Updated</span>
        </div>

        <div className="agent-grid">
          {agents.map((agent) => (
            <article className="agent-card" key={agent.id}>
              <div className="agent-card-head">
                <span className="icon-tile">
                  <Icon filled>{agent.runtime === "mock" ? "code" : "smart_toy"}</Icon>
                </span>
                <div>
                  <h2>{agent.name}</h2>
                  <p>
                    <span className="status-dot" aria-hidden="true" /> Active
                  </p>
                </div>
              </div>
              <span className="agent-model">{agent.model}</span>
              <p>{agent.instructions}</p>
              {runtimeAvailabilityWarning(agent.runtime, hostTools) ? (
                <p className="runtime-warning">
                  {runtimeAvailabilityWarning(agent.runtime, hostTools)}
                </p>
              ) : null}
              <div className="agent-card-footer">
                <button className="ghost-button" type="button">
                  Edit
                </button>
                <button className="ghost-button" type="button">
                  <Icon>build</Icon>
                  Tools
                </button>
              </div>
            </article>
          ))}

          <details className="agent-card agent-create">
            <summary>
              <span className="icon-tile">
                <Icon>add</Icon>
              </span>
              <h2>Create New Agent</h2>
              <p>Configure a custom AI assistant for a specific workflow.</p>
            </summary>
            <form className="project-form" action="/api/agents" method="post">
              <input type="hidden" name="createdByUserId" value="user_demo" />
              <label>
                Project
                <select name="projectId" defaultValue={firstProjectId}>
                  {projects.length > 0 ? (
                    projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))
                  ) : (
                    <option value="project_demo">Demo project</option>
                  )}
                </select>
              </label>
              <label>
                Name
                <input name="name" defaultValue={defaultAgentName} required />
              </label>
              <label>
                Runtime
                <select name="runtime" defaultValue={preferredRuntime}>
                  <option value="mock">mock</option>
                  <option value="codex">codex</option>
                  <option value="claude">claude</option>
                </select>
              </label>
              <label>
                Model
                <input name="model" defaultValue={defaultModel} required />
              </label>
              <label>
                Role
                <input name="role" defaultValue="Builder" required />
              </label>
              <label>
                Tools
                <input name="allowedTools" defaultValue="git,node" />
              </label>
              <label className="wide-field">
                Instructions
                <textarea name="instructions" defaultValue={defaultInstructions} required />
              </label>
              <button type="submit">Create agent</button>
            </form>
          </details>
        </div>
      </section>
    </AppShell>
  );
}

async function getAgents() {
  try {
    return await agentService.listAgents();
  } catch {
    return [];
  }
}

async function getHostTools() {
  try {
    const host = await hostService.getDemoHost();
    return Array.isArray(host?.installedToolsJson) ? (host.installedToolsJson as HostTool[]) : [];
  } catch {
    return [];
  }
}

async function getProjects() {
  try {
    return await projectService.listProjects("workspace_demo");
  } catch {
    return [];
  }
}
