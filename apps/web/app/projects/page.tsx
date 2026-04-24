import { projectService } from "../../server/projects";

export default async function ProjectsPage() {
  const projects = await getProjects();

  return (
    <main>
      <section className="workspace-shell">
        <div className="topbar">
          <div className="title-stack">
            <p className="eyebrow">Projects</p>
            <h1>Workspace Repos</h1>
          </div>
          <div className="nav-actions">
            <a className="button-link" href="/agents">
              Agents
            </a>
            <a className="button-link" href="/conversations">
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
            GitHub URL
            <input
              name="repoUrl"
              defaultValue="https://github.com/AbitatDoorothy/Workspace.git"
              required
            />
          </label>
          <label>
            Default branch
            <input name="defaultBranch" defaultValue="main" required />
          </label>
          <button type="submit">Create project</button>
        </form>

        <div className="overview-grid">
          {projects.map((project) => (
            <article className="panel" key={project.id}>
              <h2>{project.name}</h2>
              <p>{project.repoUrl}</p>
              <p>{project.defaultBranch}</p>
              <strong>{project.repoSyncStatus}</strong>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

async function getProjects() {
  try {
    return await projectService.listProjects("workspace_demo");
  } catch {
    return [];
  }
}
