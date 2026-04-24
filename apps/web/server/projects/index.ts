import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../db/client";
import { createProjectService, type DaemonJobRecord, type ProjectRecord } from "./project-service";

export const projectService = createProjectService(createPrismaProjectDb(prisma));

function createPrismaProjectDb(db: PrismaClient) {
  return {
    project: {
      async create(args: { data: Prisma.ProjectUncheckedCreateInput }) {
        return normalizeProject(await db.project.create({ data: args.data }));
      },
      async findMany(args?: { where?: Prisma.ProjectWhereInput }) {
        const projects = await db.project.findMany({
          where: args?.where,
          orderBy: { createdAt: "desc" }
        });

        return projects.map(normalizeProject);
      }
    },
    daemonJob: {
      async create(args: { data: Prisma.DaemonJobUncheckedCreateInput }) {
        return normalizeDaemonJob(await db.daemonJob.create({ data: args.data }));
      },
      async findMany(args?: { where?: Prisma.DaemonJobWhereInput }) {
        const jobs = await db.daemonJob.findMany({
          where: args?.where,
          orderBy: { createdAt: "desc" }
        });

        return jobs.map(normalizeDaemonJob);
      }
    }
  };
}

function normalizeProject(project: {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  createdByUserId: string;
  githubOwner: string | null;
  githubRepo: string | null;
  repoSyncStatus: string;
}): ProjectRecord {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    repoUrl: project.repoUrl,
    defaultBranch: project.defaultBranch,
    createdByUserId: project.createdByUserId,
    githubOwner: project.githubOwner ?? "",
    githubRepo: project.githubRepo ?? "",
    repoSyncStatus: project.repoSyncStatus
  };
}

function normalizeDaemonJob(job: {
  id: string;
  workspaceId: string;
  projectId: string | null;
  type: string;
  status: string;
  payloadJson: Prisma.JsonValue;
}): DaemonJobRecord {
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    projectId: job.projectId ?? "",
    type: "clone_repo",
    status: "queued",
    payloadJson: job.payloadJson as DaemonJobRecord["payloadJson"]
  };
}
