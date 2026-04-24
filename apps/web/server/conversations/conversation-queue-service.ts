import { randomBytes } from "node:crypto";

import {
  conversationCreateRequestSchema,
  daemonJobSchema,
  type ConversationStatus,
  type ConversationType,
  type DaemonJob,
  type Runtime
} from "@abitat/shared";
import { z } from "zod";

export interface ConversationCreateInput {
  workspaceId: string;
  projectId: string;
  agentId: string;
  createdByUserId: string;
  type: ConversationType;
  prompt: string;
}

export interface ConversationRecord extends ConversationCreateInput {
  id: string;
  status: ConversationStatus;
  errorMessage?: string | null;
  createdAt?: Date;
}

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name?: string;
  repoUrl: string;
  defaultBranch: string;
}

export interface AgentRecord {
  id: string;
  projectId: string;
  name?: string;
  runtime: Runtime;
  model: string;
  instructions: string;
  allowedToolsJson: string[];
}

export interface DaemonJobRecord {
  id: string;
  workspaceId: string;
  machineId: string | null;
  projectId: string | null;
  conversationId: string | null;
  type: string;
  status: string;
  payloadJson: unknown;
  errorMessage?: string | null;
}

interface ConversationDb {
  project: {
    findUnique(args: { where: { id: string } }): Promise<ProjectRecord | null>;
  };
  agent: {
    findUnique(args: { where: { id: string } }): Promise<AgentRecord | null>;
  };
  conversation: {
    create(args: { data: ConversationRecord }): Promise<ConversationRecord>;
    findMany(args?: { where?: { workspaceId?: string } }): Promise<ConversationRecord[]>;
    update(args: {
      where: { id: string };
      data: Partial<Pick<ConversationRecord, "status" | "errorMessage">>;
    }): Promise<ConversationRecord>;
  };
  daemonJob: {
    create(args: { data: DaemonJobRecord }): Promise<DaemonJobRecord>;
    findFirst(args: {
      where: { status: { in: string[] }; type?: string };
    }): Promise<DaemonJobRecord | null>;
    findMany(args?: {
      where?: { status?: { in: string[] }; type?: string };
    }): Promise<DaemonJobRecord[]>;
    update(args: {
      where: { id: string };
      data: Partial<Pick<DaemonJobRecord, "machineId" | "status" | "errorMessage">>;
    }): Promise<DaemonJobRecord>;
  };
}

const createConversationInputSchema = conversationCreateRequestSchema.extend({
  createdByUserId: z.string().min(1)
});

const activeConversationJobStatuses = ["queued", "preparing", "running"];

export function createConversationQueueService(db: ConversationDb) {
  return {
    async createConversation(input: ConversationCreateInput) {
      const parsed = createConversationInputSchema.parse(input);
      const [project, agent, activeJob] = await Promise.all([
        db.project.findUnique({ where: { id: parsed.projectId } }),
        db.agent.findUnique({ where: { id: parsed.agentId } }),
        db.daemonJob.findFirst({
          where: {
            type: "start_conversation",
            status: { in: activeConversationJobStatuses }
          }
        })
      ]);

      if (!project || project.workspaceId !== parsed.workspaceId) {
        throw new Error("Project not found");
      }

      if (!agent || agent.projectId !== parsed.projectId) {
        throw new Error("Agent not found");
      }

      if (activeJob) {
        throw new Error("An active daemon job is already running");
      }

      const conversation: ConversationRecord = {
        id: `conversation_${randomBytes(8).toString("hex")}`,
        workspaceId: parsed.workspaceId,
        projectId: parsed.projectId,
        agentId: parsed.agentId,
        createdByUserId: parsed.createdByUserId,
        type: parsed.type,
        status: "queued",
        prompt: parsed.prompt.trim()
      };
      const created = await db.conversation.create({ data: conversation });

      await db.daemonJob.create({
        data: {
          id: `job_${randomBytes(8).toString("hex")}`,
          workspaceId: parsed.workspaceId,
          machineId: null,
          projectId: parsed.projectId,
          conversationId: created.id,
          type: "start_conversation",
          status: "queued",
          payloadJson: {
            repoUrl: project.repoUrl,
            defaultBranch: project.defaultBranch,
            agentRuntime: agent.runtime,
            model: agent.model,
            instructions: agent.instructions,
            prompt: created.prompt,
            allowedTools: agent.allowedToolsJson
          }
        }
      });

      return created;
    },

    listConversations(workspaceId: string) {
      return db.conversation.findMany({ where: { workspaceId } });
    },

    async pollNextJob(machineId: string): Promise<DaemonJob | null> {
      const job = await db.daemonJob.findFirst({
        where: {
          type: "start_conversation",
          status: { in: ["queued"] }
        }
      });

      if (!job) {
        return null;
      }

      const updated = await db.daemonJob.update({
        where: { id: job.id },
        data: { machineId, status: "preparing" }
      });

      if (updated.conversationId) {
        await db.conversation.update({
          where: { id: updated.conversationId },
          data: { status: "preparing" }
        });
      }

      return toDaemonJob(updated);
    },

    async ackJob(jobId: string, status: "running" | "completed" | "failed", errorMessage?: string) {
      const job = await db.daemonJob.update({
        where: { id: jobId },
        data: {
          status,
          errorMessage: status === "failed" ? (errorMessage ?? "Daemon job failed") : null
        }
      });

      if (job.conversationId) {
        await db.conversation.update({
          where: { id: job.conversationId },
          data: {
            status: statusToConversationStatus(status),
            errorMessage: status === "failed" ? (errorMessage ?? "Daemon job failed") : null
          }
        });
      }

      return job;
    }
  };
}

export type ConversationQueueService = ReturnType<typeof createConversationQueueService>;

export function createResilientConversationQueueService(
  primary: ConversationQueueService,
  fallback: ConversationQueueService
): ConversationQueueService {
  return {
    createConversation(input) {
      return runWithFallback(
        () => primary.createConversation(input),
        () => fallback.createConversation(input)
      );
    },

    listConversations(workspaceId) {
      return runWithFallback(
        () => primary.listConversations(workspaceId),
        () => fallback.listConversations(workspaceId)
      );
    },

    pollNextJob(machineId) {
      return runWithFallback(
        () => primary.pollNextJob(machineId),
        () => fallback.pollNextJob(machineId)
      );
    },

    ackJob(jobId, status, errorMessage) {
      return runWithFallback(
        () => primary.ackJob(jobId, status, errorMessage),
        () => fallback.ackJob(jobId, status, errorMessage)
      );
    }
  };
}

async function runWithFallback<TResult>(
  primary: () => Promise<TResult>,
  fallback: () => Promise<TResult>
) {
  try {
    return await primary();
  } catch (error) {
    if (!isDatabaseUnavailable(error)) {
      throw error;
    }

    return fallback();
  }
}

function isDatabaseUnavailable(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";

  return code === "ECONNREFUSED" || message.includes("ECONNREFUSED");
}

function toDaemonJob(job: DaemonJobRecord) {
  return daemonJobSchema.parse({
    id: job.id,
    type: job.type,
    conversationId: job.conversationId ?? undefined,
    projectId: job.projectId ?? undefined,
    payload: job.payloadJson
  });
}

function statusToConversationStatus(
  status: "running" | "completed" | "failed"
): ConversationStatus {
  if (status === "completed") {
    return "awaiting_approval";
  }

  return status;
}
