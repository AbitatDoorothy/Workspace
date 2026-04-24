import { agentService } from "../../server/agents";
import { projectService } from "../../server/projects";

export default async function AgentsPage() {
  const [agents, projects] = await Promise.all([getAgents(), getProjects()]);
  const firstProjectId = projects[0]?.id ?? "project_demo";

  return (
    <main>
      <section className="workspace-shell">
        <div className="topbar">
          <div className="title-stack">
            <p className="eyebrow">Agents</p>
            <h1>Project Agents</h1>
          </div>
          <a className="button-link" href="/conversations">
            Conversations
          </a>
        </div>

        <form className="panel project-form" action="/api/agents" method="post">
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
            Name
            <input name="name" defaultValue="Mock Agent" required />
          </label>
          <label>
            Runtime
            <select name="runtime" defaultValue="mock">
              <option value="mock">mock</option>
              <option value="codex">codex</option>
              <option value="claude">claude</option>
            </select>
          </label>
          <label>
            Model
            <input name="model" defaultValue="mock-model" required />
          </label>
          <label>
            Role
            <input name="role" defaultValue="Builder" required />
          </label>
          <label>
            Tools
            <input name="allowedTools" defaultValue="git,node" />
          </label>
          <label className="wide-field">
            Instructions
            <textarea
              name="instructions"
              defaultValue="Use the mock runtime and keep changes small."
              required
            />
          </label>
          <button type="submit">Create agent</button>
        </form>

        <div className="overview-grid">
          {agents.map((agent) => (
            <article className="panel" key={agent.id}>
              <h2>{agent.name}</h2>
              <p>{agent.role}</p>
              <p>{agent.model}</p>
              <strong>{agent.runtime}</strong>
            </article>
          ))}
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

async function getProjects() {
  try {
    return await projectService.listProjects("workspace_demo");
  } catch {
    return [];
  }
}
