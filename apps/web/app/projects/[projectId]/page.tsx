import { AppShell, Icon } from "../../components/app-shell";
import { conversationQueueService } from "../../../server/conversations";
import { projectService } from "../../../server/projects";
import { todoStore } from "../../../server/todos";
import { ConversationBoard } from "./conversation-board";
import { StartCodexDialog } from "./start-codex-dialog";
import type { ConversationBoardConversation } from "../conversation-board-model";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [project, conversations, notStartedTodos] = await Promise.all([
    getProject(projectId),
    getProjectConversations(projectId),
    getNotStartedTodos()
  ]);

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
  const boardConversations: ConversationBoardConversation[] = conversations.map((conversation) => ({
    branchName: conversation.branchName,
    id: conversation.id,
    prompt: conversation.prompt,
    runtimeSessionId: conversation.runtimeSessionId,
    status: conversation.status,
    type: conversation.type,
    worktreePath: conversation.worktreePath
  }));

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
            <StartCodexDialog
              projectId={project.id}
              todoTasks={notStartedTodos}
              workspaceId={project.workspaceId}
            />
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

        <ConversationBoard conversations={boardConversations} projectId={project.id} />
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

async function getProjectConversations(projectId: string) {
  try {
    const conversations = await conversationQueueService.listConversations("workspace_demo");
    return conversations.filter((conversation) => conversation.projectId === projectId);
  } catch {
    return [];
  }
}

function getNotStartedTodos() {
  try {
    return todoStore.listByStatus("not_started");
  } catch {
    return [];
  }
}
