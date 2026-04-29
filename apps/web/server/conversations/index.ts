import type { Prisma, PrismaClient } from "@prisma/client";
import type { ConversationStatus, ConversationType, Runtime } from "@abitat/shared";

import { prisma } from "../db/client";
import { todoStore } from "../todos";
import {
  createConversationQueueService,
  createResilientConversationQueueService,
  type AgentRecord,
  type ConversationRecord,
  type DaemonJobRecord,
  type ProjectRecord
} from "./conversation-queue-service";

export const conversationQueueService = createResilientConversationQueueService(
  createConversationQueueService(createPrismaConversationDb(prisma), { todoStore }),
  createConversationQueueService(createDemoConversationDb(), { todoStore })
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
      async create(args: {
        data: {
          id: string;
          projectId: string;
          name: string;
          role: string;
          runtime: Runtime;
          model: string;
          instructions: string;
          allowedToolsJson: string[];
          createdByUserId: string;
        };
      }) {
        return normalizeAgent(
          await db.agent.create({ data: args.data as Prisma.AgentUncheckedCreateInput })
        );
      },
      async findFirst(args: { where: { projectId?: string; runtime?: Runtime; role?: string } }) {
        const agent = await db.agent.findFirst({ where: args.where });
        return agent ? normalizeAgent(agent) : null;
      },
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
      async delete(args: { where: { id: string } }) {
        return normalizeConversation(await db.conversation.delete({ where: args.where }));
      },
      async findUnique(args: { where: { id: string } }) {
        const conversation = await db.conversation.findUnique({ where: args.where });
        return conversation ? normalizeConversation(conversation) : null;
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
          Pick<
            ConversationRecord,
            | "branchName"
            | "commitSha"
            | "errorMessage"
            | "prompt"
            | "prUrl"
            | "runtimeSessionId"
            | "status"
            | "worktreePath"
          >
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
      async findFirst(args: {
        where: { machineId?: string; status: { in: string[] }; type?: string | { in: string[] } };
      }) {
        const job = await db.daemonJob.findFirst({
          where: {
            machineId: args.where.machineId,
            type:
              typeof args.where.type === "string"
                ? args.where.type
                : args.where.type
                  ? { in: args.where.type.in }
                  : undefined,
            status: { in: args.where.status.in }
          },
          orderBy: { createdAt: "asc" }
        });

        return job ? normalizeDaemonJob(job) : null;
      },
      async findMany(args?: {
        where?: {
          machineId?: string;
          status?: { in: string[] };
          type?: string | { in: string[] };
        };
      }) {
        const jobs = await db.daemonJob.findMany({
          where: args?.where
            ? {
                machineId: args.where.machineId,
                type:
                  typeof args.where.type === "string"
                    ? args.where.type
                    : args.where.type
                      ? { in: args.where.type.in }
                      : undefined,
                status: args.where.status ? { in: args.where.status.in } : undefined
              }
            : undefined,
          orderBy: { createdAt: "asc" }
        });

        return jobs.map(normalizeDaemonJob);
      },
      async update(args: {
        where: { id: string };
        data: Partial<Pick<DaemonJobRecord, "errorMessage" | "machineId" | "status" | "updatedAt">>;
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
  hostLocalPath: string | null;
}): ProjectRecord {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    repoUrl: project.repoUrl,
    defaultBranch: project.defaultBranch,
    hostLocalPath: project.hostLocalPath
  };
}

function normalizeAgent(agent: {
  id: string;
  projectId: string;
  name: string;
  role: string;
  runtime: Runtime;
  model: string;
  instructions: string;
  allowedToolsJson: Prisma.JsonValue;
  createdByUserId: string;
}): AgentRecord {
  return {
    id: agent.id,
    projectId: agent.projectId,
    name: agent.name,
    role: agent.role,
    runtime: agent.runtime,
    model: agent.model,
    instructions: agent.instructions,
    allowedToolsJson: Array.isArray(agent.allowedToolsJson)
      ? agent.allowedToolsJson.filter((tool): tool is string => typeof tool === "string")
      : [],
    createdByUserId: agent.createdByUserId
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
  runtimeSessionId: string | null;
  summary: string | null;
  commitSha: string | null;
  prUrl: string | null;
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
    runtimeSessionId: conversation.runtimeSessionId,
    summary: conversation.summary,
    commitSha: conversation.commitSha,
    prUrl: conversation.prUrl,
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
  updatedAt: Date;
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
    errorMessage: job.errorMessage,
    updatedAt: job.updatedAt
  };
}

export function createDemoConversationDb() {
  const store = getDemoConversationStore();
  const project: ProjectRecord = {
    id: "project_demo",
    workspaceId: "workspace_demo",
    name: "Workspace",
    repoUrl: "git@github.com:AbitatDoorothy/Workspace.git",
    defaultBranch: "main",
    hostLocalPath: null
  };
  const agent: AgentRecord = {
    id: "agent_demo",
    projectId: "project_demo",
    name: "Mock Agent",
    role: "Careful coding agent",
    runtime: "mock",
    model: "mock-model",
    instructions: "Use the mock runtime and keep changes small.",
    allowedToolsJson: ["git", "node"],
    createdByUserId: "user_demo"
  };
  store.agents.set(agent.id, agent);

  return {
    project: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === project.id ? project : null
    },
    agent: {
      create: async ({ data }: { data: AgentRecord }) => {
        store.agents.set(data.id, data);
        return data;
      },
      findFirst: async ({
        where
      }: {
        where: { projectId?: string; runtime?: Runtime; role?: string };
      }) =>
        Array.from(store.agents.values()).find(
          (candidate) =>
            (!where.projectId || candidate.projectId === where.projectId) &&
            (!where.runtime || candidate.runtime === where.runtime) &&
            (!where.role || candidate.role === where.role)
        ) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => store.agents.get(where.id) ?? null
    },
    conversation: {
      create: async ({ data }: { data: ConversationRecord }) => {
        store.conversations.set(data.id, data);
        return data;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const conversation = store.conversations.get(where.id);

        if (!conversation) {
          throw new Error(`Missing conversation ${where.id}`);
        }

        store.conversations.delete(where.id);
        return conversation;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.conversations.get(where.id) ?? null,
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
          Pick<
            ConversationRecord,
            | "branchName"
            | "commitSha"
            | "errorMessage"
            | "prompt"
            | "prUrl"
            | "runtimeSessionId"
            | "status"
            | "worktreePath"
          >
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
      findFirst: async ({
        where
      }: {
        where: { machineId?: string; status: { in: string[] }; type?: string | { in: string[] } };
      }) =>
        Array.from(store.jobs.values()).find(
          (job) =>
            where.status.in.includes(job.status) &&
            (!where.machineId || job.machineId === where.machineId) &&
            (!where.type ||
              (typeof where.type === "string"
                ? job.type === where.type
                : where.type.in.includes(job.type)))
        ) ?? null,
      findMany: async ({
        where
      }: {
        where?: {
          machineId?: string;
          status?: { in: string[] };
          type?: string | { in: string[] };
        };
      } = {}) =>
        Array.from(store.jobs.values()).filter(
          (job) =>
            (!where?.status || where.status.in.includes(job.status)) &&
            (!where?.machineId || job.machineId === where.machineId) &&
            (!where?.type ||
              (typeof where.type === "string"
                ? job.type === where.type
                : where.type.in.includes(job.type)))
        ),
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<Pick<DaemonJobRecord, "errorMessage" | "machineId" | "status" | "updatedAt">>;
      }) => {
        const current = store.jobs.get(where.id);

        if (!current) {
          throw new Error(`Missing job ${where.id}`);
        }

        const next = { ...current, ...data, updatedAt: data.updatedAt ?? new Date() };
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
      agents?: Map<string, AgentRecord>;
      jobs: Map<string, DaemonJobRecord>;
    };
  };

  globalForConversations.abitatDemoConversationStore ??= {
    conversations: new Map<string, ConversationRecord>(),
    agents: new Map<string, AgentRecord>(),
    jobs: new Map<string, DaemonJobRecord>()
  };
  globalForConversations.abitatDemoConversationStore.agents ??= new Map<string, AgentRecord>();

  return globalForConversations.abitatDemoConversationStore as {
    conversations: Map<string, ConversationRecord>;
    agents: Map<string, AgentRecord>;
    jobs: Map<string, DaemonJobRecord>;
  };
}
