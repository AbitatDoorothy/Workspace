import { AppShell, Icon } from "../components/app-shell";
import { agentService } from "../../server/agents";
import { conversationQueueService } from "../../server/conversations";
import { projectService } from "../../server/projects";
import { reviewService } from "../../server/reviews";
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
  const changeSets = await getChangeSets(conversations.map((conversation) => conversation.id));
  const firstProjectId = projects[0]?.id ?? "project_demo";
  const firstAgentId = agents[0]?.id ?? "agent_demo";

  return (
    <AppShell active="queue">
      <section className="workspace-shell compact-shell">
        <div className="page-header">
          <div className="title-stack">
            <p className="eyebrow">Conversations</p>
            <h1>Queued Work</h1>
            <p>Start, monitor, approve, cancel, and continue coding-agent conversations.</p>
          </div>
          <div className="nav-actions">
            <a className="button-link" href="/projects">
              <Icon>folder_managed</Icon>
              Projects
            </a>
            <a className="button-link" href="/agents">
              <Icon>smart_toy</Icon>
              Agents
            </a>
          </div>
        </div>

        <form className="glass-panel panel project-form" action="/api/conversations" method="post">
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
              <article className="conversation-row" key={conversation.id}>
                <div>
                  <div className="project-title-row">
                    <span className="avatar-disc">
                      <Icon filled>smart_toy</Icon>
                    </span>
                    <div>
                      <h2>{conversation.type}</h2>
                      <p>{conversation.status}</p>
                    </div>
                  </div>
                  <ConversationEvents
                    conversationId={conversation.id}
                    initialEvents={eventGroups.get(conversation.id) ?? []}
                    savedPrompt={conversation.prompt}
                  />
                  {changeSets.get(conversation.id) ? (
                    <div className="diff-review">
                      <h3>Changed Files</h3>
                      <ul>
                        {changeSets.get(conversation.id)?.filesChangedJson.map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                      <pre>{changeSets.get(conversation.id)?.diffText}</pre>
                      <form action={`/api/conversations/${conversation.id}/approve`} method="post">
                        <input type="hidden" name="approvalType" value="commit_and_push" />
                        <input type="hidden" name="approvedByUserId" value="user_demo" />
                        <input
                          name="commitMessage"
                          defaultValue={`feat: complete ${conversation.type} task`}
                          required
                        />
                        <button type="submit">Approve</button>
                      </form>
                    </div>
                  ) : null}
                  {conversation.commitSha || conversation.prUrl || conversation.errorMessage ? (
                    <div className="push-result">
                      {conversation.commitSha ? (
                        <p>
                          Commit <code>{conversation.commitSha}</code>
                        </p>
                      ) : null}
                      {conversation.prUrl ? (
                        <a href={conversation.prUrl} rel="noreferrer" target="_blank">
                          Open pull request
                        </a>
                      ) : null}
                      {conversation.errorMessage ? <p>{conversation.errorMessage}</p> : null}
                    </div>
                  ) : null}
                  {!isTerminalStatus(conversation.status) ? (
                    <form
                      action={`/api/conversations/${conversation.id}/cancel`}
                      className="cancel-form"
                      method="post"
                    >
                      <input type="hidden" name="userId" value="user_demo" />
                      <button type="submit">Cancel</button>
                    </form>
                  ) : null}
                </div>
                <strong className={`status-label status-label-${conversation.status}`}>
                  {conversation.status}
                </strong>
              </article>
            ))
          ) : (
            <article className="conversation-row">
              <div>
                <h2>No conversations</h2>
                <p>Queued work will appear here.</p>
              </div>
              <strong className="status-label status-label-queued">queued</strong>
            </article>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function isTerminalStatus(status: string) {
  return ["awaiting_approval", "cancelled", "failed", "pushed"].includes(status);
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

async function getChangeSets(conversationIds: string[]) {
  const groups = new Map<string, Awaited<ReturnType<typeof reviewService.getChangeSet>>>();

  await Promise.all(
    conversationIds.map(async (conversationId) => {
      try {
        groups.set(conversationId, await reviewService.getChangeSet(conversationId));
      } catch {
        groups.set(conversationId, null);
      }
    })
  );

  return groups;
}
