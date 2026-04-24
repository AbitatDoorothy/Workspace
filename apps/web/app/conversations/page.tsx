import { agentService } from "../../server/agents";
import { conversationQueueService } from "../../server/conversations";
import { projectService } from "../../server/projects";
import { runEventService } from "../../server/run-events";
import { ConversationEvents } from "./conversation-events";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const [agents, conversations, projects] = await Promise.all([
    getAgents(),
    getConversations(),
    getProjects()
  ]);
  const eventGroups = await getEventGroups(conversations.map((conversation) => conversation.id));
  const firstProjectId = projects[0]?.id ?? "project_demo";
  const firstAgentId = agents[0]?.id ?? "agent_demo";

  return (
    <main>
      <section className="workspace-shell">
        <div className="topbar">
          <div className="title-stack">
            <p className="eyebrow">Conversations</p>
            <h1>Queued Work</h1>
          </div>
          <div className="nav-actions">
            <a className="button-link" href="/projects">
              Projects
            </a>
            <a className="button-link" href="/agents">
              Agents
            </a>
          </div>
        </div>

        <form className="panel project-form" action="/api/conversations" method="post">
          <input type="hidden" name="workspaceId" value="workspace_demo" />
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
          <button type="submit">Start</button>
        </form>

        <div className="conversation-list">
          {conversations.length > 0 ? (
            conversations.map((conversation) => (
              <article className="panel conversation-row" key={conversation.id}>
                <div>
                  <h2>{conversation.type}</h2>
                  <p>{conversation.prompt}</p>
                  <ConversationEvents
                    conversationId={conversation.id}
                    initialEvents={eventGroups.get(conversation.id) ?? []}
                  />
                </div>
                <strong className={`status-label status-label-${conversation.status}`}>
                  {conversation.status}
                </strong>
              </article>
            ))
          ) : (
            <article className="panel conversation-row">
              <div>
                <h2>No conversations</h2>
                <p>Queued work will appear here.</p>
              </div>
              <strong className="status-label status-label-queued">queued</strong>
            </article>
          )}
        </div>
      </section>
    </main>
  );
}

async function getAgents() {
  try {
    return await agentService.listAgents();
  } catch {
    return [];
  }
}

async function getConversations() {
  try {
    return await conversationQueueService.listConversations("workspace_demo");
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

async function getEventGroups(conversationIds: string[]) {
  const groups = new Map<string, Awaited<ReturnType<typeof runEventService.listEvents>>>();

  await Promise.all(
    conversationIds.map(async (conversationId) => {
      try {
        groups.set(conversationId, await runEventService.listEvents(conversationId));
      } catch {
        groups.set(conversationId, []);
      }
    })
  );

  return groups;
}
