import { AppShell, Icon } from "../../components/app-shell";
import { agentService } from "../../../server/agents";
import { conversationQueueService } from "../../../server/conversations";
import { projectService } from "../../../server/projects";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project, agents, conversations] = await Promise.all([
    getProject(projectId),
    getAgents(projectId),
    getProjectConversations(projectId)
  ]);
  const firstAgentId = agents[0]?.id ?? "agent_demo";

  if (!project) {
    return (
      <AppShell active="projects">
        <section className="workspace-shell">
          <div className="page-header">
            <div className="title-stack">
              <p className="eyebrow">Project</p>
              <h1>Not Found</h1>
            </div>
            <a className="button-link" href="/projects">
              <Icon>arrow_back</Icon>
              Projects
            </a>
          </div>
        </section>
      </AppShell>
    );
  }

  const projectPath = project.hostLocalPath ?? project.repoUrl;

  return (
    <AppShell active="projects">
      <section className="workspace-shell compact-shell">
        <header className="page-header">
          <div className="title-stack">
            <p className="eyebrow">
              <a href="/projects">Projects</a> / {project.name}
            </p>
            <div className="project-title-row">
              <h1>{project.name}</h1>
              <span className="status-pill">
                <span className="status-dot" aria-hidden="true" />
                Connected
              </span>
            </div>
            <p className="project-path">
              <Icon>folder</Icon>
              {projectPath}
            </p>
          </div>
          <div className="nav-actions">
            <a className="primary-button" href="#new-conversation">
              <Icon>add_comment</Icon>
              New conversation
            </a>
          </div>
        </header>

        <section className="stats-grid">
          <article className="glass-card stat-card project-summary">
            <span className="icon-tile">
              <Icon>description</Icon>
            </span>
            <div>
              <p>Total Conversations</p>
              <h2>{conversations.length}</h2>
            </div>
          </article>
          <article className="glass-card stat-card project-summary">
            <span className="icon-tile icon-tile-warm">
              <Icon>sync</Icon>
            </span>
            <div>
              <p>Last Sync Status</p>
              <h2>{project.repoSyncStatus}</h2>
            </div>
          </article>
          <article className="glass-card stat-card project-summary">
            <span className="icon-tile">
              <Icon>call_split</Icon>
            </span>
            <div>
              <p>Connected Branch</p>
              <h2>{project.defaultBranch}</h2>
            </div>
          </article>
        </section>

        <form
          className="glass-panel panel project-form"
          action="/api/conversations"
          id="new-conversation"
          method="post"
        >
          <input type="hidden" name="workspaceId" value={project.workspaceId} />
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="createdByUserId" value="user_demo" />
          <input type="hidden" name="redirectTo" value={`/projects/${project.id}`} />
          <label>
            Agent
            <select name="agentId" defaultValue={firstAgentId}>
              {agents.length > 0 ? (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))
              ) : (
                <option value="agent_demo">Demo agent</option>
              )}
            </select>
          </label>
          <label>
            Type
            <select name="type" defaultValue="feature">
              <option value="feature">feature</option>
              <option value="bugfix">bugfix</option>
              <option value="investigation">investigation</option>
              <option value="refactor">refactor</option>
            </select>
          </label>
          <label className="wide-field">
            Prompt
            <textarea name="prompt" defaultValue="Add a useful page." required />
          </label>
          <button type="submit">Add new conversation</button>
        </form>

        <div className="content-grid">
          <section>
            <div className="section-heading">
              <h2>Active Conversations</h2>
              <a className="muted" href="/conversations">
                View All
              </a>
            </div>
            <div className="glass-card conversation-preview-list">
              {conversations.length > 0 ? (
                conversations.map((conversation) => (
                  <a
                    className="conversation-preview"
                    href={`/projects/${project.id}/conversations/${conversation.id}`}
                    key={conversation.id}
                  >
                    <span className="avatar-disc">
                      <Icon filled>smart_toy</Icon>
                    </span>
                    <div>
                      <h2>{conversation.type}</h2>
                      <p>{conversation.prompt}</p>
                      <span className={`status-label status-label-${conversation.status}`}>
                        {conversation.status}
                      </span>
                    </div>
                    <span className="muted">Open</span>
                  </a>
                ))
              ) : (
                <article className="conversation-preview">
                  <span className="avatar-disc">
                    <Icon>add_comment</Icon>
                  </span>
                  <div>
                    <h2>No conversations</h2>
                    <p>Add a new conversation to start a fresh Codex session.</p>
                  </div>
                </article>
              )}
            </div>
          </section>

          <section>
            <div className="section-heading">
              <h2>Recent Activity</h2>
            </div>
            <div className="glass-card tool-card">
              {conversations.slice(0, 3).map((conversation) => (
                <div className="conversation-preview" key={conversation.id}>
                  <span className="avatar-disc">
                    <Icon>commit</Icon>
                  </span>
                  <div>
                    <h3>{conversation.type}</h3>
                    <p>
                      {conversation.status} on {project.defaultBranch}
                    </p>
                  </div>
                </div>
              ))}
              {conversations.length === 0 ? (
                <p>No project activity yet. New agent work will appear here.</p>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}

async function getProject(projectId: string) {
  try {
    const projects = await projectService.listProjects("workspace_demo");
    return projects.find((project) => project.id === projectId) ?? null;
  } catch {
    return null;
  }
}

async function getAgents(projectId: string) {
  try {
    return await agentService.listAgents(projectId);
  } catch {
    return [];
  }
}

async function getProjectConversations(projectId: string) {
  try {
    const conversations = await conversationQueueService.listConversations("workspace_demo");
    return conversations.filter((conversation) => conversation.projectId === projectId);
  } catch {
    return [];
  }
}
