import { AppShell, Icon } from "../../components/app-shell";
import { getServerAccountContext } from "../../../server/auth/request-session";
import { conversationQueueService } from "../../../server/conversations";
import { codexAppService, isCodexProjectId } from "../../../server/codex-app";
import { projectService } from "../../../server/projects";
import { todoStore } from "../../../server/todos";
import { ConversationBoard } from "./conversation-board";
import { StartCodexDialog } from "./start-codex-dialog";
import type { ConversationBoardConversation } from "../conversation-board-model";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const account = await getServerAccountContext();
  const [project, conversations, notStartedTodos] = await Promise.all([
    getProject(projectId, account.workspaceId),
    getProjectConversations(projectId, account.workspaceId),
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

  const projectPath = project.hostLocalPath;
  const isCodexAppProject = project.source === "codex_app";
  const boardConversations: ConversationBoardConversation[] = conversations.map((conversation) => ({
    branchName: conversation.branchName,
    codexDeepLink: conversation.codexDeepLink,
    id: conversation.id,
    prompt: conversation.prompt,
    runtimeSessionId: conversation.runtimeSessionId,
    source: conversation.source,
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
            {isCodexAppProject ? null : (
              <StartCodexDialog
                projectId={project.id}
                todoTasks={notStartedTodos}
                userId={account.userId}
                workspaceId={project.workspaceId}
              />
            )}
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
              <h2>{isCodexAppProject ? "codex app" : project.repoSyncStatus}</h2>
            </div>
          </article>
        </section>

        <ConversationBoard
          conversations={boardConversations}
          projectId={project.id}
          userId={account.userId}
        />
      </section>
    </AppShell>
  );
}

async function getProject(projectId: string, workspaceId: string) {
  try {
    if (isCodexProjectId(projectId)) {
      return await codexAppService.getProject(projectId);
    }

    const projects = await projectService.listProjects(workspaceId);
    const project = projects.find((candidate) => candidate.id === projectId);
    return project ? { ...project, source: "abitat" as const } : null;
  } catch {
    return null;
  }
}

async function getProjectConversations(projectId: string, workspaceId: string) {
  try {
    if (isCodexProjectId(projectId)) {
      return await codexAppService.listProjectConversations(projectId);
    }

    const conversations = await conversationQueueService.listConversations(workspaceId);
    return conversations
      .filter((conversation) => conversation.projectId === projectId)
      .map((conversation) => ({
        ...conversation,
        codexDeepLink: null,
        source: "abitat" as const
      }));
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
