import { randomBytes } from "node:crypto";

interface ProjectCreateInput {
  workspaceId: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  createdByUserId: string;
}

export interface ProjectRecord extends ProjectCreateInput {
  id: string;
  githubOwner: string;
  githubRepo: string;
  repoSyncStatus: string;
}

export interface DaemonJobRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  type: "clone_repo";
  status: "queued";
  payloadJson: {
    repoUrl: string;
    defaultBranch: string;
  };
}

interface ProjectDb {
  project: {
    create(args: { data: ProjectRecord }): Promise<ProjectRecord>;
    findMany(args?: { where?: Partial<ProjectRecord> }): Promise<ProjectRecord[]>;
  };
  daemonJob: {
    create(args: { data: DaemonJobRecord }): Promise<DaemonJobRecord>;
  };
}

export function parseGithubRepoUrl(repoUrl: string) {
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(repoUrl);

  if (ssh) {
    return normalizeParts(ssh[1], ssh[2]);
  }

  try {
    const url = new URL(repoUrl);

    if (url.hostname !== "github.com") {
      throw new Error("Invalid GitHub repo URL");
    }

    const [owner, repo] = url.pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/, "")
      .split("/");
    return normalizeParts(owner, repo);
  } catch {
    throw new Error("Invalid GitHub repo URL");
  }
}

export function createProjectService(db: ProjectDb) {
  return {
    async createProject(input: ProjectCreateInput) {
      const parsed = parseGithubRepoUrl(input.repoUrl);
      const project: ProjectRecord = {
        ...input,
        id: `project_${randomBytes(8).toString("hex")}`,
        ...parsed,
        repoSyncStatus: "queued"
      };

      const created = await db.project.create({ data: project });
      await db.daemonJob.create({
        data: {
          id: `job_${randomBytes(8).toString("hex")}`,
          workspaceId: input.workspaceId,
          projectId: created.id,
          type: "clone_repo",
          status: "queued",
          payloadJson: {
            repoUrl: input.repoUrl,
            defaultBranch: input.defaultBranch
          }
        }
      });

      return created;
    },

    listProjects(workspaceId: string) {
      return db.project.findMany({ where: { workspaceId } });
    }
  };
}

function normalizeParts(owner: string | undefined, repo: string | undefined) {
  if (!owner || !repo || owner.includes("..") || repo.includes("..") || repo.includes("/")) {
    throw new Error("Invalid GitHub repo URL");
  }

  return {
    githubOwner: owner,
    githubRepo: repo
  };
}
