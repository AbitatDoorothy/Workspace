import { describe, expect, it } from "vitest";

import { createProjectService } from "../server/projects/project-service";

interface TestProject {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  hostLocalPath?: string | null;
  createdByUserId: string;
  repoSyncStatus: string;
}

type CreateArgs<TRecord> = { data: TRecord };

function createProjectDb() {
  const projects = new Map<string, TestProject>();

  return {
    project: {
      create: async ({ data }: CreateArgs<TestProject>) => {
        projects.set(data.id, data);
        return data;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const project = projects.get(where.id);

        if (!project) {
          throw new Error(`Missing project ${where.id}`);
        }

        projects.delete(where.id);
        return project;
      },
      findMany: async () => Array.from(projects.values())
    }
  };
}

describe("project service", () => {
  it("creates a local folder project without a source mode", async () => {
    const db = createProjectDb();
    const service = createProjectService(db);

    const project = await service.createProject({
      workspaceId: "workspace_demo",
      name: "Desktop Test",
      hostLocalPath: "/Users/reece/Desktop/Test",
      createdByUserId: "user_demo"
    });

    expect(project).toMatchObject({
      repoUrl: "/Users/reece/Desktop/Test",
      hostLocalPath: "/Users/reece/Desktop/Test",
      repoSyncStatus: "ready"
    });
    expect(project).not.toHaveProperty("defaultBranch");
  });

  it("rejects project creation without an absolute local folder", async () => {
    const db = createProjectDb();
    const service = createProjectService(db);

    await expect(
      service.createProject({
        workspaceId: "workspace_demo",
        name: "Desktop Test",
        hostLocalPath: "relative/path",
        createdByUserId: "user_demo"
      })
    ).rejects.toThrow("Local folder path must be absolute");
  });

  it("deletes a project", async () => {
    const db = createProjectDb();
    const service = createProjectService(db);
    const project = await service.createProject({
      workspaceId: "workspace_demo",
      name: "Desktop Test",
      hostLocalPath: "/Users/reece/Desktop/Test",
      createdByUserId: "user_demo"
    });

    await service.deleteProject(project.id);

    expect(await service.listProjects("workspace_demo")).toEqual([]);
  });
});
