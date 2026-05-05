import { cookies } from "next/headers";

import { AppShell, Icon } from "../components/app-shell";
import { codexAppService } from "../../server/codex-app";
import { projectService } from "../../server/projects";
import { PROJECT_DRAFT_COOKIE_NAME, getProjectDraft } from "../../server/projects/project-drafts";
import { CreateProjectDialog } from "./create-project-dialog";

export default async function ProjectsPage({
  searchParams
}: {
  searchParams: Promise<{ projectDraftId?: string }>;
}) {
  const [{ projectDraftId }, projects, cookieStore] = await Promise.all([
    searchParams,
    getProjects(),
    cookies()
  ]);
  const projectDraft = getProjectDraft(
    projectDraftId,
    cookieStore.get(PROJECT_DRAFT_COOKIE_NAME)?.value
  );

  return (
    <AppShell active="projects">
      <section className="workspace-shell compact-shell">
        <div className="page-header">
          <div className="title-stack">
            <p className="eyebrow">Projects</p>
            <h1>Workspace Repos</h1>
            <p>Connect local folders on this Mac.</p>
          </div>
          <div className="nav-actions">
            <CreateProjectDialog draft={projectDraft} workspaceId="workspace_demo" />
          </div>
        </div>

        <div className="overview-grid">
          {projects.map((project) => (
            <article className="panel project-card-link project-card" key={project.id}>
              <div className="card-topline">
                <span className="icon-tile">
                  <Icon>folder</Icon>
                </span>
                <span className="status-pill">
                  {project.source === "codex_app" ? "Codex app" : "local"}
                </span>
              </div>
              <div>
                <h2>{project.name}</h2>
                <p>{project.hostLocalPath}</p>
              </div>
              <div className="project-card-actions">
                <strong>{project.repoSyncStatus}</strong>
                <a className="ghost-button" href={`/projects/${project.id}`}>
                  <Icon>folder_open</Icon>
                  Open
                </a>
                {project.source === "codex_app" ? null : (
                  <form action={`/api/projects/${project.id}/delete`} method="post">
                    <button className="danger-button" type="submit">
                      <Icon>delete</Icon>
                      Delete
                    </button>
                  </form>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function getProjects() {
  const [localProjects, codexProjects] = await Promise.allSettled([
    projectService.listProjects("workspace_demo"),
    codexAppService.listProjects()
  ]);

  return [
    ...(codexProjects.status === "fulfilled" ? codexProjects.value : []),
    ...(localProjects.status === "fulfilled"
      ? localProjects.value.map((project) => ({ ...project, source: "abitat" as const }))
      : [])
  ];
}
