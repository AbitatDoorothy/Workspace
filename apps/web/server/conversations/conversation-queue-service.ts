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

import { assertWorkspaceMember } from "../auth/role-checks";
import type { TodoStore } from "../todos/todo-store";

export interface ConversationCreateInput {
  workspaceId: string;
  projectId: string;
  agentId?: string;
  runtime?: Runtime;
  createdByUserId: string;
  type?: ConversationType;
  prompt?: string;
}

export interface ConversationRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  agentId: string;
  createdByUserId: string;
  type: ConversationType;
  prompt: string;
  status: ConversationStatus;
  branchName?: string | null;
  worktreePath?: string | null;
  runtimeSessionId?: string | null;
  summary?: string | null;
  commitSha?: string | null;
  prUrl?: string | null;
  errorMessage?: string | null;
  createdAt?: Date;
}

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name?: string;
  repoUrl: string;
  defaultBranch: string;
  hostLocalPath?: string | null;
}

export interface AgentRecord {
  id: string;
  projectId: string;
  name?: string;
  role?: string;
  runtime: Runtime;
  model: string;
  instructions: string;
  allowedToolsJson: string[];
  createdByUserId?: string;
}

interface AgentCreateRecord {
  id: string;
  projectId: string;
  name: string;
  role: string;
  runtime: Runtime;
  model: string;
  instructions: string;
  allowedToolsJson: string[];
  createdByUserId: string;
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
  updatedAt?: Date;
}

interface ConversationDb {
  project: {
    findUnique(args: { where: { id: string } }): Promise<ProjectRecord | null>;
  };
  agent: {
    create(args: { data: AgentCreateRecord }): Promise<AgentRecord>;
    findFirst(args: {
      where: { projectId?: string; runtime?: Runtime; role?: string };
    }): Promise<AgentRecord | null>;
    findUnique(args: { where: { id: string } }): Promise<AgentRecord | null>;
  };
  conversation: {
    create(args: { data: ConversationRecord }): Promise<ConversationRecord>;
    delete(args: { where: { id: string } }): Promise<ConversationRecord>;
    findUnique(args: { where: { id: string } }): Promise<ConversationRecord | null>;
    findMany(args?: { where?: { workspaceId?: string } }): Promise<ConversationRecord[]>;
    update(args: {
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
    }): Promise<ConversationRecord>;
  };
  daemonJob: {
    create(args: { data: DaemonJobRecord }): Promise<DaemonJobRecord>;
    findFirst(args: {
      where: { machineId?: string; status: { in: string[] }; type?: string | { in: string[] } };
    }): Promise<DaemonJobRecord | null>;
    findMany(args?: {
      where?: {
        machineId?: string;
        status?: { in: string[] };
        type?: string | { in: string[] };
      };
    }): Promise<DaemonJobRecord[]>;
    update(args: {
      where: { id: string };
      data: Partial<Pick<DaemonJobRecord, "errorMessage" | "machineId" | "status" | "updatedAt">>;
    }): Promise<DaemonJobRecord>;
  };
}

interface ConversationQueueServiceOptions {
  todoStore?: Pick<TodoStore, "completeConversationTask">;
}

const createConversationInputSchema = conversationCreateRequestSchema.extend({
  createdByUserId: z.string().min(1)
});
const continueConversationInputSchema = z.object({
  prompt: z.string().trim().default(""),
  userId: z.string().min(1)
});
const conversationLabelSchema = z.enum(["in_process", "complete"]);
const internalDefaultAgentRole = "internal_default_runtime";
const defaultRuntimeInstructions = {
  codex:
    "Start an interactive Codex CLI in this project. Use the user's local Codex configuration and wait for the user's terminal instructions.",
  claude:
    "Start an interactive Claude CLI in this project. Use the user's local Claude configuration and wait for the user's terminal instructions.",
  mock: "Use the mock runtime and keep changes small."
} satisfies Record<Runtime, string>;

export function createConversationQueueService(
  db: ConversationDb,
  options: ConversationQueueServiceOptions = {}
) {
  return {
    async createConversation(input: ConversationCreateInput) {
      const parsed = createConversationInputSchema.parse(input);
      const project = await db.project.findUnique({ where: { id: parsed.projectId } });

      if (!project || project.workspaceId !== parsed.workspaceId) {
        throw new Error("Project not found");
      }

      assertWorkspaceMember({
        workspaceId: parsed.workspaceId,
        userId: parsed.createdByUserId
      });

      const agent = await resolveConversationAgent(db, {
        agentId: parsed.agentId,
        createdByUserId: parsed.createdByUserId,
        projectId: parsed.projectId,
        runtime: parsed.runtime
      });

      if (!agent || agent.projectId !== parsed.projectId) {
        throw new Error("Agent not found");
      }

      const conversation: ConversationRecord = {
        id: `conversation_${randomBytes(8).toString("hex")}`,
        workspaceId: parsed.workspaceId,
        projectId: parsed.projectId,
        agentId: agent.id,
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
          payloadJson: startConversationPayload(project, agent, created)
        }
      });

      return created;
    },

    async continueConversation(conversationId: string, input: { prompt: string; userId: string }) {
      const parsed = continueConversationInputSchema.parse(input);
      const conversation = await db.conversation.findUnique({ where: { id: conversationId } });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      const [project, agent] = await Promise.all([
        db.project.findUnique({ where: { id: conversation.projectId } }),
        db.agent.findUnique({ where: { id: conversation.agentId } })
      ]);

      if (!project || project.workspaceId !== conversation.workspaceId) {
        throw new Error("Project not found");
      }

      if (!agent || agent.projectId !== conversation.projectId) {
        throw new Error("Agent not found");
      }

      if (!conversation.worktreePath || !conversation.branchName) {
        throw new Error("Conversation is missing git worktree metadata");
      }

      if (!conversation.runtimeSessionId && agent.runtime !== "mock") {
        throw new Error("Conversation is missing runtime session metadata");
      }

      assertWorkspaceMember({
        workspaceId: conversation.workspaceId,
        userId: parsed.userId
      });

      const updated = await db.conversation.update({
        where: { id: conversation.id },
        data: {
          errorMessage: null,
          prompt: parsed.prompt || conversation.prompt,
          status: "queued"
        }
      });

      await db.daemonJob.create({
        data: {
          id: `job_${randomBytes(8).toString("hex")}`,
          workspaceId: updated.workspaceId,
          machineId: null,
          projectId: updated.projectId,
          conversationId: updated.id,
          type: "start_conversation",
          status: "queued",
          payloadJson: startConversationPayload(project, agent, updated, {
            branchName: updated.branchName ?? undefined,
            resumeSessionId: updated.runtimeSessionId ?? undefined,
            worktreePath: updated.worktreePath ?? undefined
          })
        }
      });

      return updated;
    },

    async setConversationLabel(
      conversationId: string,
      input: { label: z.infer<typeof conversationLabelSchema>; userId: string }
    ) {
      const parsed = z
        .object({
          label: conversationLabelSchema,
          userId: z.string().min(1)
        })
        .parse(input);
      const conversation = await db.conversation.findUnique({ where: { id: conversationId } });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      assertWorkspaceMember({
        workspaceId: conversation.workspaceId,
        userId: parsed.userId
      });

      const updated = await db.conversation.update({
        where: { id: conversation.id },
        data: {
          status: parsed.label === "complete" ? "pushed" : "running"
        }
      });

      if (parsed.label !== "complete") {
        return updated;
      }

      options.todoStore?.completeConversationTask(conversation.id);

      const [project, agent] = await Promise.all([
        db.project.findUnique({ where: { id: conversation.projectId } }),
        db.agent.findUnique({ where: { id: conversation.agentId } })
      ]);

      if (
        project &&
        agent &&
        conversation.branchName &&
        conversation.runtimeSessionId &&
        conversation.worktreePath
      ) {
        await db.daemonJob.create({
          data: {
            id: `job_${randomBytes(8).toString("hex")}`,
            workspaceId: conversation.workspaceId,
            machineId: null,
            projectId: conversation.projectId,
            conversationId: conversation.id,
            type: "summarize_conversation",
            status: "queued",
            payloadJson: startConversationPayload(project, agent, conversation, {
              branchName: conversation.branchName,
              presentation: "inline",
              prompt: summaryPrompt(conversation),
              resumeSessionId: conversation.runtimeSessionId,
              worktreePath: conversation.worktreePath
            })
          }
        });
      }

      return updated;
    },

    async deleteConversation(conversationId: string, input: { userId: string }) {
      const parsed = z
        .object({
          userId: z.string().min(1)
        })
        .parse(input);
      const conversation = await db.conversation.findUnique({ where: { id: conversationId } });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      assertWorkspaceMember({
        workspaceId: conversation.workspaceId,
        userId: parsed.userId
      });

      const message = `Deleted by ${parsed.userId}`;
      const activeJobs = await db.daemonJob.findMany({
        where: {
          status: { in: ["queued", "preparing", "running"] }
        }
      });

      await Promise.all(
        activeJobs
          .filter((job) => job.conversationId === conversation.id)
          .map((job) =>
            db.daemonJob.update({
              where: { id: job.id },
              data: {
                status: "cancelled",
                errorMessage: message
              }
            })
          )
      );

      await db.conversation.delete({ where: { id: conversation.id } });

      return { ok: true as const };
    },

    listConversations(workspaceId: string) {
      return db.conversation.findMany({ where: { workspaceId } });
    },

    async pollNextJob(machineId: string): Promise<DaemonJob | null> {
      const job = await db.daemonJob.findFirst({
        where: {
          type: { in: ["start_conversation", "commit_and_push", "summarize_conversation"] },
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
          data: { status: jobTypeToPreparingStatus(updated.type) }
        });
      }

      return toDaemonJob(updated);
    },

    async ackJob(
      jobId: string,
      status: "running" | "completed" | "failed",
      details: {
        branchName?: string;
        commitSha?: string;
        errorMessage?: string;
        prUrl?: string;
        runtimeSessionId?: string;
        worktreePath?: string;
      } = {}
    ) {
      const job = await db.daemonJob.update({
        where: { id: jobId },
        data: {
          status,
          errorMessage: status === "failed" ? (details.errorMessage ?? "Daemon job failed") : null
        }
      });

      if (job.conversationId) {
        const conversationData: Partial<
          Pick<
            ConversationRecord,
            | "branchName"
            | "commitSha"
            | "errorMessage"
            | "prUrl"
            | "runtimeSessionId"
            | "status"
            | "worktreePath"
          >
        > = {
          status: statusToConversationStatus(status, job.type)
        };

        if (details.branchName !== undefined) {
          conversationData.branchName = details.branchName;
        }

        if (details.worktreePath !== undefined) {
          conversationData.worktreePath = details.worktreePath;
        }

        if (details.runtimeSessionId !== undefined) {
          conversationData.runtimeSessionId = details.runtimeSessionId;
        }

        if (details.commitSha !== undefined) {
          conversationData.commitSha = details.commitSha;
        }

        if (details.prUrl !== undefined) {
          conversationData.prUrl = details.prUrl;
        }

        if (status === "failed") {
          conversationData.errorMessage = details.errorMessage ?? "Daemon job failed";
        } else if (details.errorMessage !== undefined) {
          conversationData.errorMessage = details.errorMessage;
        }

        await db.conversation.update({
          where: { id: job.conversationId },
          data: conversationData
        });
      }

      return job;
    },

    async cancelConversation(conversationId: string, input: { userId: string }) {
      const conversation = await db.conversation.findUnique({ where: { id: conversationId } });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      const message = `Cancelled by ${input.userId}`;
      await db.conversation.update({
        where: { id: conversationId },
        data: {
          status: "cancelled",
          errorMessage: message
        }
      });

      const activeJobs = await db.daemonJob.findMany({
        where: {
          status: { in: ["queued", "preparing", "running"] }
        }
      });

      await Promise.all(
        activeJobs
          .filter((job) => job.conversationId === conversationId)
          .map((job) =>
            db.daemonJob.update({
              where: { id: job.id },
              data: {
                status: "cancelled",
                errorMessage: message
              }
            })
          )
      );

      return { ok: true as const, status: "cancelled" as const };
    },

    async recoverStaleJobs(
      machineId: string,
      options: {
        activeConversationId?: string;
        activeConversationIds?: string[];
        now?: Date;
        staleAfterMs?: number;
      } = {}
    ) {
      const now = options.now ?? new Date();
      const staleAfterMs = options.staleAfterMs ?? 5 * 60 * 1000;
      const activeConversationIds = new Set([
        ...(options.activeConversationId ? [options.activeConversationId] : []),
        ...(options.activeConversationIds ?? [])
      ]);
      const staleJobs = (
        await db.daemonJob.findMany({
          where: {
            machineId,
            status: { in: ["preparing", "running"] }
          }
        })
      ).filter((job) => {
        if (job.conversationId && activeConversationIds.has(job.conversationId)) {
          return false;
        }

        const updatedAt = job.updatedAt ?? now;
        return now.getTime() - updatedAt.getTime() > staleAfterMs;
      });
      const message = "Daemon reconnected before this job completed";

      await Promise.all(
        staleJobs.map(async (job) => {
          await db.daemonJob.update({
            where: { id: job.id },
            data: {
              status: "failed",
              errorMessage: message
            }
          });

          if (job.conversationId) {
            await db.conversation.update({
              where: { id: job.conversationId },
              data: {
                status: "failed",
                errorMessage: message
              }
            });
          }
        })
      );

      return staleJobs.length;
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

    continueConversation(conversationId, input) {
      return runWithFallback(
        () => primary.continueConversation(conversationId, input),
        () => fallback.continueConversation(conversationId, input)
      );
    },

    setConversationLabel(conversationId, input) {
      return runWithFallback(
        () => primary.setConversationLabel(conversationId, input),
        () => fallback.setConversationLabel(conversationId, input)
      );
    },

    deleteConversation(conversationId, input) {
      return runWithFallback(
        () => primary.deleteConversation(conversationId, input),
        () => fallback.deleteConversation(conversationId, input)
      );
    },

    pollNextJob(machineId) {
      return runWithFallback(
        () => primary.pollNextJob(machineId),
        () => fallback.pollNextJob(machineId)
      );
    },

    ackJob(jobId, status, details) {
      return runWithFallback(
        () => primary.ackJob(jobId, status, details),
        () => fallback.ackJob(jobId, status, details)
      );
    },

    cancelConversation(conversationId, input) {
      return runWithFallback(
        () => primary.cancelConversation(conversationId, input),
        () => fallback.cancelConversation(conversationId, input)
      );
    },

    recoverStaleJobs(machineId, options) {
      return runWithFallback(
        () => primary.recoverStaleJobs(machineId, options),
        () => fallback.recoverStaleJobs(machineId, options)
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

async function resolveConversationAgent(
  db: ConversationDb,
  input: {
    agentId?: string;
    createdByUserId: string;
    projectId: string;
    runtime: Runtime;
  }
) {
  if (input.agentId) {
    return db.agent.findUnique({ where: { id: input.agentId } });
  }

  const existing = await db.agent.findFirst({
    where: {
      projectId: input.projectId,
      runtime: input.runtime,
      role: internalDefaultAgentRole
    }
  });

  if (existing) {
    return existing;
  }

  return db.agent.create({
    data: {
      id: `agent_${randomBytes(8).toString("hex")}`,
      projectId: input.projectId,
      name: input.runtime === "codex" ? "Codex" : input.runtime === "claude" ? "Claude" : "Mock",
      role: internalDefaultAgentRole,
      runtime: input.runtime,
      model: "",
      instructions: defaultRuntimeInstructions[input.runtime],
      allowedToolsJson: [],
      createdByUserId: input.createdByUserId
    }
  });
}

function startConversationPayload(
  project: ProjectRecord,
  agent: AgentRecord,
  conversation: ConversationRecord,
  continuation: {
    branchName?: string;
    presentation?: "terminal" | "inline";
    prompt?: string;
    resumeSessionId?: string;
    worktreePath?: string;
  } = {}
) {
  const runtimePrompt =
    continuation.prompt ??
    (agent.role === internalDefaultAgentRole && !continuation.resumeSessionId
      ? ""
      : conversation.prompt);

  return {
    repoUrl: project.repoUrl,
    defaultBranch: project.defaultBranch,
    hostLocalPath: project.hostLocalPath ?? undefined,
    conversationType: conversation.type,
    agentRuntime: agent.runtime,
    ...(agent.model.trim() ? { model: agent.model } : {}),
    instructions: agent.instructions,
    presentation: continuation.presentation ?? "terminal",
    prompt: runtimePrompt,
    taskTitle: conversation.prompt || undefined,
    allowedTools: agent.allowedToolsJson,
    ...continuation
  };
}

function statusToConversationStatus(
  status: "running" | "completed" | "failed",
  jobType: string
): ConversationStatus {
  if (jobType === "summarize_conversation") {
    return "pushed";
  }

  if (jobType === "commit_and_push") {
    if (status === "completed") {
      return "pushed";
    }

    if (status === "running") {
      return "committing";
    }
  }

  if (status === "completed") {
    return "awaiting_approval";
  }

  return status;
}

function jobTypeToPreparingStatus(jobType: string): ConversationStatus {
  if (jobType === "summarize_conversation") {
    return "pushed";
  }

  return jobType === "commit_and_push" ? "committing" : "preparing";
}

function summaryPrompt(conversation: ConversationRecord) {
  return [
    "Summarize what has been done in this Codex thread for the web summary page.",
    "Return a concise plain-text summary with the main changes, decisions, and any remaining follow-up.",
    "Do not continue implementation work.",
    conversation.prompt ? `Task title: ${conversation.prompt}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
