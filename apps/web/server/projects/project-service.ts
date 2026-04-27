import { randomBytes } from "node:crypto";
import { isAbsolute, normalize } from "node:path";

interface ProjectCreateInput {
  workspaceId: string;
  name: string;
  sourceType?: "github" | "local";
  repoUrl?: string;
  defaultBranch?: string;
  hostLocalPath?: string;
  createdByUserId: string;
}

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  hostLocalPath?: string | null;
  createdByUserId: string;
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
      const sourceType = input.sourceType ?? "github";
      const project =
        sourceType === "local" ? createLocalProject(input) : createGithubProject(input);

      const created = await db.project.create({ data: project });

      if (sourceType === "local") {
        return created;
      }

      await db.daemonJob.create({
        data: {
          id: `job_${randomBytes(8).toString("hex")}`,
          workspaceId: input.workspaceId,
          projectId: created.id,
          type: "clone_repo",
          status: "queued",
          payloadJson: {
            repoUrl: created.repoUrl,
            defaultBranch: created.defaultBranch
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

function createGithubProject(input: ProjectCreateInput): ProjectRecord {
  const repoUrl = input.repoUrl?.trim();

  if (!repoUrl) {
    throw new Error("GitHub URL is required");
  }

  const parsed = parseGithubRepoUrl(repoUrl);

  return {
    id: `project_${randomBytes(8).toString("hex")}`,
    workspaceId: input.workspaceId,
    name: input.name,
    repoUrl,
    defaultBranch: input.defaultBranch?.trim() || "main",
    hostLocalPath: null,
    createdByUserId: input.createdByUserId,
    ...parsed,
    repoSyncStatus: "queued"
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
    defaultBranch: input.defaultBranch?.trim() || "local",
    hostLocalPath,
    createdByUserId: input.createdByUserId,
    githubOwner: "",
    githubRepo: "",
    repoSyncStatus: "ready"
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
