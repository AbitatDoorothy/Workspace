import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../db/client";
import { createProjectService, type ProjectRecord } from "./project-service";

export const projectService = createProjectService(createPrismaProjectDb(prisma));

function createPrismaProjectDb(db: PrismaClient) {
  return {
    project: {
      async create(args: { data: Prisma.ProjectUncheckedCreateInput }) {
        return normalizeProject(await db.project.create({ data: args.data }));
      },
      async delete(args: { where: { id: string } }) {
        return normalizeProject(await db.project.delete({ where: args.where }));
      },
      async findMany(args?: { where?: Prisma.ProjectWhereInput }) {
        const projects = await db.project.findMany({
          where: args?.where,
          orderBy: { createdAt: "desc" }
        });

        return projects.map(normalizeProject);
      }
    }
  };
}

function normalizeProject(project: {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  hostLocalPath: string | null;
  createdByUserId: string;
  repoSyncStatus: string;
}): ProjectRecord {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    repoUrl: project.repoUrl,
    hostLocalPath: project.hostLocalPath,
    createdByUserId: project.createdByUserId,
    repoSyncStatus: project.repoSyncStatus
  };
}
