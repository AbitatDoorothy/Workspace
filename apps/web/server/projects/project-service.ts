import { randomBytes } from "node:crypto";
import { isAbsolute, normalize } from "node:path";

interface ProjectCreateInput {
  workspaceId: string;
  name: string;
  hostLocalPath?: string;
  createdByUserId: string;
}

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  hostLocalPath?: string | null;
  createdByUserId: string;
  repoSyncStatus: string;
}

interface ProjectDb {
  project: {
    create(args: { data: ProjectRecord }): Promise<ProjectRecord>;
    delete(args: { where: { id: string } }): Promise<ProjectRecord>;
    findMany(args?: { where?: Partial<ProjectRecord> }): Promise<ProjectRecord[]>;
  };
}

export function createProjectService(db: ProjectDb) {
  return {
    async createProject(input: ProjectCreateInput) {
      const project = createLocalProject(input);
      const created = await db.project.create({ data: project });
      return created;
    },

    listProjects(workspaceId: string) {
      return db.project.findMany({ where: { workspaceId } });
    },

    deleteProject(projectId: string) {
      return db.project.delete({ where: { id: projectId } });
    }
  };
}

function createLocalProject(input: ProjectCreateInput): ProjectRecord {
  const hostLocalPath = normalize(input.hostLocalPath?.trim() ?? "");

  if (!hostLocalPath || !isAbsolute(hostLocalPath)) {
    throw new Error("Local folder path must be absolute");
  }

  return {
    id: `project_${randomBytes(8).toString("hex")}`,
    workspaceId: input.workspaceId,
    name: input.name,
    repoUrl: hostLocalPath,
    hostLocalPath,
    createdByUserId: input.createdByUserId,
    repoSyncStatus: "ready"
  };
}
