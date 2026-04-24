import type { Prisma, PrismaClient } from "@prisma/client";
import type { ConversationStatus, ConversationType, Runtime } from "@abitat/shared";

import { prisma } from "../db/client";
import {
  createConversationQueueService,
  createResilientConversationQueueService,
  type AgentRecord,
  type ConversationRecord,
  type DaemonJobRecord,
  type ProjectRecord
} from "./conversation-queue-service";

export const conversationQueueService = createResilientConversationQueueService(
  createConversationQueueService(createPrismaConversationDb(prisma)),
  createConversationQueueService(createDemoConversationDb())
);

function createPrismaConversationDb(db: PrismaClient) {
  return {
    project: {
      async findUnique(args: { where: { id: string } }) {
        const project = await db.project.findUnique({ where: args.where });
        return project ? normalizeProject(project) : null;
      }
    },
    agent: {
      async findUnique(args: { where: { id: string } }) {
        const agent = await db.agent.findUnique({ where: args.where });
        return agent ? normalizeAgent(agent) : null;
      }
    },
    conversation: {
      async create(args: { data: ConversationRecord }) {
        return normalizeConversation(
          await db.conversation.create({
            data: args.data as Prisma.ConversationUncheckedCreateInput
          })
        );
      },
      async findMany(args?: { where?: { workspaceId?: string } }) {
        const conversations = await db.conversation.findMany({
          where: args?.where,
          orderBy: { createdAt: "desc" }
        });

        return conversations.map(normalizeConversation);
      },
      async update(args: {
        where: { id: string };
        data: Partial<
          Pick<ConversationRecord, "branchName" | "errorMessage" | "status" | "worktreePath">
        >;
      }) {
        return normalizeConversation(
          await db.conversation.update({
            where: args.where,
            data: args.data as Prisma.ConversationUncheckedUpdateInput
          })
        );
      }
    },
    daemonJob: {
      async create(args: { data: DaemonJobRecord }) {
        return normalizeDaemonJob(
          await db.daemonJob.create({ data: args.data as Prisma.DaemonJobUncheckedCreateInput })
        );
      },
      async findFirst(args: { where: { status: { in: string[] }; type?: string } }) {
        const job = await db.daemonJob.findFirst({
          where: {
            type: args.where.type,
            status: { in: args.where.status.in }
          },
          orderBy: { createdAt: "asc" }
        });

        return job ? normalizeDaemonJob(job) : null;
      },
      async findMany(args?: { where?: { status?: { in: string[] }; type?: string } }) {
        const jobs = await db.daemonJob.findMany({
          where: args?.where
            ? {
                type: args.where.type,
                status: args.where.status ? { in: args.where.status.in } : undefined
              }
            : undefined,
          orderBy: { createdAt: "asc" }
        });

        return jobs.map(normalizeDaemonJob);
      },
      async update(args: {
        where: { id: string };
        data: Partial<Pick<DaemonJobRecord, "machineId" | "status" | "errorMessage">>;
      }) {
        return normalizeDaemonJob(
          await db.daemonJob.update({
            where: args.where,
            data: args.data as Prisma.DaemonJobUncheckedUpdateInput
          })
        );
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
}): ProjectRecord {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    repoUrl: project.repoUrl,
    defaultBranch: project.defaultBranch
  };
}

function normalizeAgent(agent: {
  id: string;
  projectId: string;
  name: string;
  runtime: Runtime;
  model: string;
  instructions: string;
  allowedToolsJson: Prisma.JsonValue;
}): AgentRecord {
  return {
    id: agent.id,
    projectId: agent.projectId,
    name: agent.name,
    runtime: agent.runtime,
    model: agent.model,
    instructions: agent.instructions,
    allowedToolsJson: Array.isArray(agent.allowedToolsJson)
      ? agent.allowedToolsJson.filter((tool): tool is string => typeof tool === "string")
      : []
  };
}

function normalizeConversation(conversation: {
  id: string;
  workspaceId: string;
  projectId: string;
  agentId: string;
  createdByUserId: string;
  type: ConversationType;
  status: ConversationStatus;
  prompt: string;
  branchName: string | null;
  worktreePath: string | null;
  errorMessage: string | null;
  createdAt: Date;
}): ConversationRecord {
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    projectId: conversation.projectId,
    agentId: conversation.agentId,
    createdByUserId: conversation.createdByUserId,
    type: conversation.type,
    status: conversation.status,
    prompt: conversation.prompt,
    branchName: conversation.branchName,
    worktreePath: conversation.worktreePath,
    errorMessage: conversation.errorMessage,
    createdAt: conversation.createdAt
  };
}

function normalizeDaemonJob(job: {
  id: string;
  workspaceId: string;
  machineId: string | null;
  projectId: string | null;
  conversationId: string | null;
  type: string;
  status: string;
  payloadJson: Prisma.JsonValue;
  errorMessage: string | null;
}): DaemonJobRecord {
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    machineId: job.machineId,
    projectId: job.projectId,
    conversationId: job.conversationId,
    type: job.type,
    status: job.status,
    payloadJson: job.payloadJson,
    errorMessage: job.errorMessage
  };
}

function createDemoConversationDb() {
  const store = getDemoConversationStore();
  const project: ProjectRecord = {
    id: "project_demo",
    workspaceId: "workspace_demo",
    name: "Workspace",
    repoUrl: "https://github.com/AbitatDoorothy/Workspace.git",
    defaultBranch: "main"
  };
  const agent: AgentRecord = {
    id: "agent_demo",
    projectId: "project_demo",
    name: "Mock Agent",
    runtime: "mock",
    model: "mock-model",
    instructions: "Use the mock runtime and keep changes small.",
    allowedToolsJson: ["git", "node"]
  };

  return {
    project: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === project.id ? project : null
    },
    agent: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === agent.id ? agent : null
    },
    conversation: {
      create: async ({ data }: { data: ConversationRecord }) => {
        store.conversations.set(data.id, data);
        return data;
      },
      findMany: async ({ where }: { where?: { workspaceId?: string } } = {}) =>
        Array.from(store.conversations.values()).filter(
          (conversation) => !where?.workspaceId || conversation.workspaceId === where.workspaceId
        ),
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<
          Pick<ConversationRecord, "branchName" | "errorMessage" | "status" | "worktreePath">
        >;
      }) => {
        const current = store.conversations.get(where.id);

        if (!current) {
          throw new Error(`Missing conversation ${where.id}`);
        }

        const next = { ...current, ...data };
        store.conversations.set(where.id, next);
        return next;
      }
    },
    daemonJob: {
      create: async ({ data }: { data: DaemonJobRecord }) => {
        store.jobs.set(data.id, data);
        return data;
      },
      findFirst: async ({ where }: { where: { status: { in: string[] }; type?: string } }) =>
        Array.from(store.jobs.values()).find(
          (job) => where.status.in.includes(job.status) && (!where.type || job.type === where.type)
        ) ?? null,
      findMany: async ({ where }: { where?: { status?: { in: string[] }; type?: string } } = {}) =>
        Array.from(store.jobs.values()).filter(
          (job) =>
            (!where?.status || where.status.in.includes(job.status)) &&
            (!where?.type || job.type === where.type)
        ),
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<Pick<DaemonJobRecord, "machineId" | "status" | "errorMessage">>;
      }) => {
        const current = store.jobs.get(where.id);

        if (!current) {
          throw new Error(`Missing job ${where.id}`);
        }

        const next = { ...current, ...data };
        store.jobs.set(where.id, next);
        return next;
      }
    }
  };
}

function getDemoConversationStore() {
  const globalForConversations = globalThis as typeof globalThis & {
    abitatDemoConversationStore?: {
      conversations: Map<string, ConversationRecord>;
      jobs: Map<string, DaemonJobRecord>;
    };
  };

  globalForConversations.abitatDemoConversationStore ??= {
    conversations: new Map<string, ConversationRecord>(),
    jobs: new Map<string, DaemonJobRecord>()
  };

  return globalForConversations.abitatDemoConversationStore;
}
