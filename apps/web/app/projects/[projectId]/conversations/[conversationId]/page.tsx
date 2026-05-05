import { AppShell, Icon } from "../../../../components/app-shell";
import { ConversationSummaryPanel } from "../../../../conversations/conversation-summary-panel";
import {
  codexAppService,
  isCodexConversationId,
  isCodexProjectId
} from "../../../../../server/codex-app";
import { conversationQueueService } from "../../../../../server/conversations";
import { projectService } from "../../../../../server/projects";
import { runEventService } from "../../../../../server/run-events";

export const dynamic = "force-dynamic";

export default async function ProjectConversationPage({
  params
}: {
  params: Promise<{ projectId: string; conversationId: string }>;
}) {
  const { projectId, conversationId } = await params;

  if (isCodexProjectId(projectId) || isCodexConversationId(conversationId)) {
    return <CodexAppConversationHistory projectId={projectId} conversationId={conversationId} />;
  }

  const [project, conversation, events] = await Promise.all([
    getProject(projectId),
    getConversation(projectId, conversationId),
    getEvents(conversationId)
  ]);

  if (!project || !conversation) {
    return (
      <AppShell active="projects">
        <section className="workspace-shell">
          <div className="page-header">
            <div className="title-stack">
              <p className="eyebrow">Conversation</p>
              <h1>Not Found</h1>
            </div>
            <a className="button-link" href={`/projects/${projectId}`}>
              Project
            </a>
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell active="projects">
      <section className="conversation-summary-shell">
        <ConversationSummaryPanel
          conversationId={conversation.id}
          initialEvents={events.filter((event) => event.type === "summary")}
          savedSummary={conversation.summary}
        />
      </section>
    </AppShell>
  );
}

async function CodexAppConversationHistory({
  conversationId,
  projectId
}: {
  conversationId: string;
  projectId: string;
}) {
  const [project, conversation, messages] = await Promise.all([
    codexAppService.getProject(projectId),
    codexAppService.getConversation(conversationId),
    codexAppService.listMessages(conversationId)
  ]);

  if (!project || !conversation) {
    return (
      <AppShell active="projects">
        <section className="workspace-shell">
          <div className="page-header">
            <div className="title-stack">
              <p className="eyebrow">Conversation</p>
              <h1>Not Found</h1>
            </div>
            <a className="button-link" href={`/projects/${projectId}`}>
              Project
            </a>
          </div>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell active="projects">
      <section className="conversation-summary-shell">
        <article className="conversation-summary-panel">
          <div className="page-header">
            <div className="title-stack">
              <p className="eyebrow">
                <a href={`/projects/${project.id}`}>{project.name}</a> / Codex app history
              </p>
              <h1>{conversation.prompt}</h1>
            </div>
            <a className="button-link" href={conversation.codexDeepLink}>
              <Icon>open_in_new</Icon>
              Open Codex
            </a>
          </div>

          {messages.length > 0 ? (
            <div className="conversation-summary-copy">
              {messages.map((message) => (
                <p key={message.id}>
                  <strong>{message.role}</strong>
                  {"\n"}
                  {message.content}
                </p>
              ))}
            </div>
          ) : (
            <p className="conversation-summary-empty">
              No messages have synced for this thread yet.
            </p>
          )}
        </article>
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

async function getConversation(projectId: string, conversationId: string) {
  try {
    const conversations = await conversationQueueService.listConversations("workspace_demo");
    return (
      conversations.find(
        (conversation) => conversation.id === conversationId && conversation.projectId === projectId
      ) ?? null
    );
  } catch {
    return null;
  }
}

async function getEvents(conversationId: string) {
  try {
    return await runEventService.listEvents(conversationId);
  } catch {
    return [];
  }
}
