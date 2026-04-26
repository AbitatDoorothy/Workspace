import { describe, expect, it } from "vitest";
import type { ConversationStatus } from "@abitat/shared";

import {
  createConversationQueueService,
  createResilientConversationQueueService,
  type ConversationQueueService
} from "../server/conversations/conversation-queue-service";

interface TestProject {
  id: string;
  workspaceId: string;
  repoUrl: string;
  defaultBranch: string;
}

interface TestAgent {
  id: string;
  projectId: string;
  runtime: "mock" | "codex" | "claude";
  model: string;
  instructions: string;
  allowedToolsJson: string[];
}

interface TestConversation {
  id: string;
  agentId: string;
  projectId: string;
  workspaceId: string;
  createdByUserId: string;
  type: "feature" | "bugfix" | "investigation" | "refactor";
  status: ConversationStatus;
  prompt: string;
  branchName?: string | null;
  worktreePath?: string | null;
  commitSha?: string | null;
  prUrl?: string | null;
  errorMessage?: string | null;
}

interface TestDaemonJob {
  id: string;
  workspaceId: string;
  machineId: string | null;
  conversationId: string | null;
  projectId: string | null;
  type: string;
  status: string;
  payloadJson: unknown;
  errorMessage?: string | null;
  updatedAt?: Date;
}

type JobFindFirstArgs = {
  where: {
    status: { in: string[] };
    machineId?: string;
    type?: string | { in: string[] };
  };
};

function createConversationDb(existingJob?: TestDaemonJob) {
  const conversations = new Map<string, TestConversation>();
  const jobs = new Map<string, TestDaemonJob>();

  if (existingJob) {
    jobs.set(existingJob.id, existingJob);
  }

  const project: TestProject = {
    id: "project_demo",
    workspaceId: "workspace_demo",
    repoUrl: "https://github.com/AbitatDoorothy/Workspace.git",
    defaultBranch: "main"
  };
  const agent: TestAgent = {
    id: "agent_demo",
    projectId: "project_demo",
    runtime: "mock",
    model: "mock-model",
    instructions: "Use mock runtime.",
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
      create: async ({ data }: { data: TestConversation }) => {
        conversations.set(data.id, data);
        return data;
      },
      findMany: async () => Array.from(conversations.values()),
      findUnique: async ({ where }: { where: { id: string } }) =>
        conversations.get(where.id) ?? null,
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<TestConversation>;
      }) => {
        const current = conversations.get(where.id);

        if (!current) {
          throw new Error(`Missing conversation ${where.id}`);
        }

        const next = { ...current, ...data };
        conversations.set(where.id, next);
        return next;
      }
    },
    daemonJob: {
      create: async ({ data }: { data: TestDaemonJob }) => {
        jobs.set(data.id, data);
        return data;
      },
      findFirst: async ({ where }: JobFindFirstArgs) =>
        Array.from(jobs.values()).find(
          (job) =>
            where.status.in.includes(job.status) &&
            (!where.machineId || job.machineId === where.machineId) &&
            (!where.type ||
              (typeof where.type === "string"
                ? job.type === where.type
                : where.type.in.includes(job.type)))
        ) ?? null,
      findMany: async ({ where }: { where?: JobFindFirstArgs["where"] } = {}) =>
        Array.from(jobs.values()).filter(
          (job) =>
            (!where?.status || where.status.in.includes(job.status)) &&
            (!where?.machineId || job.machineId === where.machineId) &&
            (!where?.type ||
              (typeof where.type === "string"
                ? job.type === where.type
                : where.type.in.includes(job.type)))
        ),
      update: async ({ where, data }: { where: { id: string }; data: Partial<TestDaemonJob> }) => {
        const current = jobs.get(where.id);

        if (!current) {
          throw new Error(`Missing job ${where.id}`);
        }

        const next = { ...current, ...data, updatedAt: data.updatedAt ?? new Date() };
        jobs.set(where.id, next);
        return next;
      }
    }
  };
}

describe("conversation queue service", () => {
  it("creates a queued conversation and start_conversation daemon job", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);

    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Add a useful page."
    });
    const jobs = await db.daemonJob.findMany();

    expect(conversation.status).toBe("queued");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: "start_conversation",
      status: "queued",
      conversationId: conversation.id
    });
  });

  it("prevents creating a second active daemon job", async () => {
    const service = createConversationQueueService(
      createConversationDb({
        id: "job_existing",
        workspaceId: "workspace_demo",
        machineId: null,
        conversationId: "conversation_existing",
        projectId: "project_demo",
        type: "start_conversation",
        status: "running",
        payloadJson: {}
      })
    );

    await expect(
      service.createConversation({
        workspaceId: "workspace_demo",
        projectId: "project_demo",
        agentId: "agent_demo",
        createdByUserId: "user_demo",
        type: "feature",
        prompt: "Add a useful page."
      })
    ).rejects.toThrow("An active daemon job is already running");
  });

  it("polls and acknowledges daemon jobs with conversation status transitions", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "bugfix",
      prompt: "Fix a useful page."
    });

    const job = await service.pollNextJob("machine_demo");
    expect(job?.type).toBe("start_conversation");
    expect((await db.conversation.findMany())[0].status).toBe("preparing");

    await service.ackJob(job?.id ?? "", "running", {
      branchName: "abitat/bugfix/abc123-fix-a-useful-page",
      worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo"
    });
    expect((await db.conversation.findMany())[0]).toMatchObject({
      id: conversation.id,
      status: "running",
      branchName: "abitat/bugfix/abc123-fix-a-useful-page",
      worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo"
    });
  });

  it("falls back to demo queue storage when the primary database is unavailable", async () => {
    const databaseError = new Error("connection refused");
    Object.assign(databaseError, { code: "ECONNREFUSED" });
    const primary: ConversationQueueService = {
      createConversation: async () => {
        throw databaseError;
      },
      listConversations: async () => {
        throw databaseError;
      },
      pollNextJob: async () => {
        throw databaseError;
      },
      ackJob: async () => {
        throw databaseError;
      },
      cancelConversation: async () => {
        throw databaseError;
      },
      recoverStaleJobs: async () => {
        throw databaseError;
      }
    };
    const fallback = createConversationQueueService(createConversationDb());
    const service = createResilientConversationQueueService(primary, fallback);

    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Add a useful page."
    });

    expect(conversation.status).toBe("queued");
    expect(await service.pollNextJob("machine_demo")).toMatchObject({
      type: "start_conversation",
      conversationId: conversation.id
    });
  });

  it("polls and acknowledges commit_and_push jobs with pushed metadata", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Add a useful page."
    });
    const jobs = await db.daemonJob.findMany();
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "approved",
        branchName: "abitat/feature/abcdef12-add-a-useful-page",
        worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo"
      }
    });
    await db.daemonJob.update({
      where: { id: jobs[0]?.id ?? "" },
      data: {
        type: "commit_and_push",
        status: "queued",
        payloadJson: {
          commitMessage: "feat: add mock run log",
          branchName: "abitat/feature/abcdef12-add-a-useful-page",
          worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo"
        }
      }
    });

    const job = await service.pollNextJob("machine_demo");
    expect(job?.type).toBe("commit_and_push");
    expect((await db.conversation.findMany())[0].status).toBe("committing");

    await service.ackJob(job?.id ?? "", "completed", {
      commitSha: "abc123",
      prUrl: "https://github.com/AbitatDoorothy/Workspace/pull/1",
      errorMessage: "gh is not authenticated"
    });
    expect((await db.conversation.findMany())[0]).toMatchObject({
      status: "pushed",
      commitSha: "abc123",
      prUrl: "https://github.com/AbitatDoorothy/Workspace/pull/1",
      errorMessage: "gh is not authenticated"
    });
  });

  it("cancels a conversation and its active daemon jobs", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Add a useful page."
    });

    await service.cancelConversation(conversation.id, { userId: "user_demo" });

    expect((await db.conversation.findMany())[0]).toMatchObject({
      status: "cancelled",
      errorMessage: "Cancelled by user_demo"
    });
    expect((await db.daemonJob.findMany())[0]).toMatchObject({
      status: "cancelled",
      errorMessage: "Cancelled by user_demo"
    });
  });

  it("recovers stale running jobs after daemon reconnect", async () => {
    const db = createConversationDb({
      id: "job_existing",
      workspaceId: "workspace_demo",
      machineId: "machine_demo",
      conversationId: "conversation_existing",
      projectId: "project_demo",
      type: "start_conversation",
      status: "running",
      payloadJson: {},
      updatedAt: new Date("2026-04-24T00:00:00.000Z")
    });
    await db.conversation.create({
      data: {
        id: "conversation_existing",
        workspaceId: "workspace_demo",
        projectId: "project_demo",
        agentId: "agent_demo",
        createdByUserId: "user_demo",
        type: "feature",
        status: "running",
        prompt: "Add a useful page."
      }
    });
    const service = createConversationQueueService(db);

    await expect(
      service.recoverStaleJobs("machine_demo", {
        now: new Date("2026-04-24T00:05:01.000Z"),
        staleAfterMs: 300_000
      })
    ).resolves.toBe(1);
    expect((await db.conversation.findMany())[0]).toMatchObject({
      status: "failed",
      errorMessage: "Daemon reconnected before this job completed"
    });
  });

  it("does not recover the daemon's active conversation", async () => {
    const db = createConversationDb({
      id: "job_existing",
      workspaceId: "workspace_demo",
      machineId: "machine_demo",
      conversationId: "conversation_existing",
      projectId: "project_demo",
      type: "start_conversation",
      status: "running",
      payloadJson: {},
      updatedAt: new Date("2026-04-24T00:00:00.000Z")
    });
    await db.conversation.create({
      data: {
        id: "conversation_existing",
        workspaceId: "workspace_demo",
        projectId: "project_demo",
        agentId: "agent_demo",
        createdByUserId: "user_demo",
        type: "feature",
        status: "running",
        prompt: "Add a useful page."
      }
    });
    const service = createConversationQueueService(db);

    await expect(
      service.recoverStaleJobs("machine_demo", {
        activeConversationId: "conversation_existing",
        now: new Date("2026-04-24T00:05:01.000Z"),
        staleAfterMs: 300_000
      })
    ).resolves.toBe(0);
    expect((await db.conversation.findMany())[0]).toMatchObject({
      status: "running"
    });
  });
});
