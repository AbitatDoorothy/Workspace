import { AppShell, Icon } from "../components/app-shell";
import { projectService } from "../../server/projects";

export default async function ProjectsPage() {
  const projects = await getProjects();

  return (
    <AppShell active="projects">
      <section className="workspace-shell compact-shell">
        <div className="page-header">
          <div className="title-stack">
            <p className="eyebrow">Projects</p>
            <h1>Workspace Repos</h1>
            <p>Connect GitHub repositories or local folders on this Mac.</p>
          </div>
          <div className="nav-actions">
            <a className="button-link" href="/agents">
              <Icon>smart_toy</Icon>
              Agents
            </a>
            <a className="button-link" href="/conversations">
              <Icon>slow_motion_video</Icon>
              Conversations
            </a>
          </div>
        </div>

        <form className="panel project-form" action="/api/projects" method="post">
          <input type="hidden" name="workspaceId" value="workspace_demo" />
          <input type="hidden" name="createdByUserId" value="user_demo" />
          <label>
            Name
            <input name="name" defaultValue="Workspace" required />
          </label>
          <label>
            Mode
            <select name="sourceType" defaultValue="github">
              <option value="github">GitHub</option>
              <option value="local">Local folder</option>
            </select>
          </label>
          <label>
            GitHub URL
            <input
              name="repoUrl"
              defaultValue="git@github.com:AbitatDoorothy/Workspace.git"
              required
            />
          </label>
          <label>
            Local folder
            <input name="hostLocalPath" defaultValue="/Users/reece/Desktop/Test" />
          </label>
          <label>
            Default branch
            <input name="defaultBranch" defaultValue="main" required />
          </label>
          <button type="submit">Create project</button>
        </form>

        <div className="overview-grid">
          {projects.map((project) => (
            <article className="panel project-card-link project-card" key={project.id}>
              <div className="card-topline">
                <span className="icon-tile">
                  <Icon>{project.hostLocalPath ? "folder" : "code"}</Icon>
                </span>
                <span className="status-pill">{project.hostLocalPath ? "local" : "github"}</span>
              </div>
              <div>
                <h2>{project.name}</h2>
                <p>{project.hostLocalPath ?? project.repoUrl}</p>
              </div>
              <p>
                <Icon>call_split</Icon> {project.defaultBranch}
              </p>
              <div className="project-card-actions">
                <strong>{project.repoSyncStatus}</strong>
                <a className="ghost-button" href={`/projects/${project.id}`}>
                  <Icon>folder_open</Icon>
                  Open
                </a>
                <form action={`/api/projects/${project.id}/delete`} method="post">
                  <button className="danger-button" type="submit">
                    <Icon>delete</Icon>
                    Delete
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function getProjects() {
  try {
    return await projectService.listProjects("workspace_demo");
  } catch {
    return [];
  }
}
