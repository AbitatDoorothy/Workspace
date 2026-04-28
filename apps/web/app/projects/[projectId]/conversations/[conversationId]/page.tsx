import { AppShell } from "../../../../components/app-shell";
import { ConversationSummaryPanel } from "../../../../conversations/conversation-summary-panel";
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
