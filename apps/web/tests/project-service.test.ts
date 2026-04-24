import { describe, expect, it } from "vitest";

import { createProjectService, parseGithubRepoUrl } from "../server/projects/project-service";

interface TestProject {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  createdByUserId: string;
  githubOwner: string;
  githubRepo: string;
  repoSyncStatus: string;
}

interface TestDaemonJob {
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

type CreateArgs<TRecord> = { data: TRecord };

function createProjectDb() {
  const projects = new Map<string, TestProject>();
  const jobs = new Map<string, TestDaemonJob>();

  return {
    project: {
      create: async ({ data }: CreateArgs<TestProject>) => {
        projects.set(data.id, data);
        return data;
      },
      findMany: async () => Array.from(projects.values())
    },
    daemonJob: {
      create: async ({ data }: CreateArgs<TestDaemonJob>) => {
        jobs.set(data.id, data);
        return data;
      },
      findMany: async () => Array.from(jobs.values())
    }
  };
}

describe("project service", () => {
  it("parses GitHub HTTPS and SSH URLs", () => {
    expect(parseGithubRepoUrl("https://github.com/AbitatDoorothy/Workspace.git")).toEqual({
      githubOwner: "AbitatDoorothy",
      githubRepo: "Workspace"
    });
    expect(parseGithubRepoUrl("git@github.com:AbitatDoorothy/Workspace.git")).toEqual({
      githubOwner: "AbitatDoorothy",
      githubRepo: "Workspace"
    });
  });

  it("rejects non-GitHub URLs", () => {
    expect(() => parseGithubRepoUrl("https://example.com/nope.git")).toThrow(
      "Invalid GitHub repo URL"
    );
  });

  it("creates a project and queues a clone job", async () => {
    const db = createProjectDb();
    const service = createProjectService(db);

    const project = await service.createProject({
      workspaceId: "workspace_demo",
      name: "Workspace",
      repoUrl: "https://github.com/AbitatDoorothy/Workspace.git",
      defaultBranch: "main",
      createdByUserId: "user_demo"
    });

    const jobs = await db.daemonJob.findMany();
    expect(project).toMatchObject({
      githubOwner: "AbitatDoorothy",
      githubRepo: "Workspace",
      repoSyncStatus: "queued"
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: "clone_repo",
      status: "queued",
      projectId: project.id
    });
  });
});
