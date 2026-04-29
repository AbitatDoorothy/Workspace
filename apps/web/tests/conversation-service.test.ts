import { describe, expect, it } from "vitest";
import type { ConversationStatus } from "@abitat/shared";

import {
  createConversationQueueService,
  createResilientConversationQueueService,
  type ConversationQueueService
} from "../server/conversations/conversation-queue-service";
import { createDemoConversationDb } from "../server/conversations";

interface TestProject {
  id: string;
  workspaceId: string;
  repoUrl: string;
  defaultBranch: string;
  hostLocalPath?: string | null;
}

interface TestAgent {
  id: string;
  projectId: string;
  name?: string;
  role?: string;
  runtime: "mock" | "codex" | "claude";
  model: string;
  instructions: string;
  allowedToolsJson: string[];
  createdByUserId?: string;
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
  runtimeSessionId?: string | null;
}

function createTodoStoreSpy() {
  const completedConversationIds: string[] = [];

  return {
    completedConversationIds,
    store: {
      completeConversationTask: (conversationId: string) => {
        completedConversationIds.push(conversationId);
        return [];
      }
    }
  };
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
  const agents = new Map<string, TestAgent>();

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
    name: "Mock Agent",
    role: "Careful coding agent",
    runtime: "mock",
    model: "mock-model",
    instructions: "Use mock runtime.",
    allowedToolsJson: ["git", "node"],
    createdByUserId: "user_demo"
  };
  agents.set(agent.id, agent);

  return {
    project: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === project.id ? project : null,
      update: async ({ data }: { where: { id: string }; data: Partial<TestProject> }) => {
        Object.assign(project, data);
        return project;
      }
    },
    agent: {
      findUnique: async ({ where }: { where: { id: string } }) => agents.get(where.id) ?? null,
      findFirst: async ({
        where
      }: {
        where: { projectId?: string; runtime?: "mock" | "codex" | "claude"; role?: string };
      }) =>
        Array.from(agents.values()).find(
          (candidate) =>
            (!where.projectId || candidate.projectId === where.projectId) &&
            (!where.runtime || candidate.runtime === where.runtime) &&
            (!where.role || candidate.role === where.role)
        ) ?? null,
      create: async ({ data }: { data: TestAgent }) => {
        agents.set(data.id, data);
        return data;
      }
    },
    conversation: {
      create: async ({ data }: { data: TestConversation }) => {
        conversations.set(data.id, data);
        return data;
      },
      findMany: async () => Array.from(conversations.values()),
      findUnique: async ({ where }: { where: { id: string } }) =>
        conversations.get(where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        const conversation = conversations.get(where.id);

        if (!conversation) {
          throw new Error(`Missing conversation ${where.id}`);
        }

        conversations.delete(where.id);
        return conversation;
      },
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

  it("queues a conversation without an initial web prompt", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);

    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: ""
    });
    const jobs = await db.daemonJob.findMany();

    expect(conversation).toMatchObject({
      status: "queued",
      prompt: ""
    });
    expect(jobs.at(-1)).toMatchObject({
      type: "start_conversation",
      status: "queued",
      payloadJson: {
        prompt: ""
      }
    });
  });

  it("starts a Codex conversation without requiring the user to choose an agent", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);

    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      createdByUserId: "user_demo",
      runtime: "codex"
    });
    const jobs = await db.daemonJob.findMany();

    expect(conversation).toMatchObject({
      agentId: expect.stringMatching(/^agent_/),
      prompt: "",
      status: "queued",
      type: "investigation"
    });
    expect(jobs.at(-1)).toMatchObject({
      type: "start_conversation",
      conversationId: conversation.id,
      payloadJson: {
        agentRuntime: "codex",
        instructions: expect.stringContaining("Codex"),
        prompt: ""
      }
    });
    expect((jobs.at(-1)?.payloadJson as { model?: string }).model).toBeUndefined();
  });

  it("uses the task title for the card without sending it as the initial Codex prompt", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);

    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      createdByUserId: "user_demo",
      runtime: "codex",
      type: "bugfix",
      prompt: "Fix login redirect"
    });
    const jobs = await db.daemonJob.findMany();

    expect(conversation).toMatchObject({
      prompt: "Fix login redirect",
      type: "bugfix"
    });
    expect(jobs.at(-1)).toMatchObject({
      type: "start_conversation",
      payloadJson: {
        agentRuntime: "codex",
        conversationType: "bugfix",
        prompt: "",
        taskTitle: "Fix login redirect"
      }
    });
  });

  it("queues a hidden same-thread summary job when a conversation is marked complete", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      createdByUserId: "user_demo",
      runtime: "codex",
      type: "feature",
      prompt: "Add local notes"
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        branchName: "abitat/feature/local-notes",
        runtimeSessionId: "session_123",
        status: "running",
        worktreePath: "/tmp/local-notes"
      }
    });

    const completed = await service.setConversationLabel(conversation.id, {
      label: "complete",
      userId: "user_demo"
    });
    const jobs = await db.daemonJob.findMany();

    expect(completed.status).toBe("pushed");
    expect(jobs.at(-1)).toMatchObject({
      conversationId: conversation.id,
      type: "summarize_conversation",
      status: "queued",
      payloadJson: {
        agentRuntime: "codex",
        branchName: "abitat/feature/local-notes",
        presentation: "inline",
        resumeSessionId: "session_123",
        taskTitle: "Add local notes",
        worktreePath: "/tmp/local-notes"
      }
    });
    expect((jobs.at(-1)?.payloadJson as { prompt?: string }).prompt).toContain("Summarize");
  });

  it("hydrates hot-reloaded demo storage before creating a default runtime agent", async () => {
    const globalForConversations = globalThis as typeof globalThis & {
      abitatDemoConversationStore?: {
        conversations: Map<string, TestConversation>;
        agents?: Map<string, TestAgent>;
        jobs: Map<string, TestDaemonJob>;
      };
    };
    const previousStore = globalForConversations.abitatDemoConversationStore;

    try {
      globalForConversations.abitatDemoConversationStore = {
        conversations: new Map<string, TestConversation>(),
        jobs: new Map<string, TestDaemonJob>()
      };

      const service = createConversationQueueService(createDemoConversationDb());
      const conversation = await service.createConversation({
        workspaceId: "workspace_demo",
        projectId: "project_demo",
        createdByUserId: "user_demo",
        runtime: "codex"
      });

      expect(conversation.agentId).toMatch(/^agent_/);
      expect(globalForConversations.abitatDemoConversationStore.agents).toBeInstanceOf(Map);
    } finally {
      globalForConversations.abitatDemoConversationStore = previousStore;
    }
  });

  it("continues an existing conversation without an initial web prompt", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Create the first file."
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "awaiting_approval",
        branchName: "abitat/feature/abcdef12-create-the-first-file",
        worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo",
        runtimeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
      }
    });
    await db.daemonJob.update({
      where: { id: (await db.daemonJob.findMany())[0]?.id ?? "" },
      data: { status: "completed" }
    });

    const continued = await service.continueConversation(conversation.id, {
      prompt: "",
      userId: "user_demo"
    });
    const jobs = await db.daemonJob.findMany();

    expect(continued).toMatchObject({
      id: conversation.id,
      status: "queued",
      prompt: "Create the first file.",
      runtimeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
    });
    expect(jobs.at(-1)).toMatchObject({
      type: "start_conversation",
      status: "queued",
      conversationId: conversation.id,
      payloadJson: {
        resumeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce",
        prompt: "Create the first file."
      }
    });
  });

  it("queues local folder conversations with the host local path", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    await db.project.update({
      where: { id: "project_demo" },
      data: {
        repoUrl: "/Users/reece/Desktop/Test",
        defaultBranch: "local",
        hostLocalPath: "/Users/reece/Desktop/Test"
      }
    });

    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Create a local success file."
    });
    const jobs = await db.daemonJob.findMany();

    expect(jobs.at(-1)).toMatchObject({
      type: "start_conversation",
      conversationId: conversation.id,
      payloadJson: {
        repoUrl: "/Users/reece/Desktop/Test",
        defaultBranch: "local",
        hostLocalPath: "/Users/reece/Desktop/Test"
      }
    });
  });

  it("allows multiple active start conversation jobs", async () => {
    const db = createConversationDb({
      id: "job_existing",
      workspaceId: "workspace_demo",
      machineId: null,
      conversationId: "conversation_existing",
      projectId: "project_demo",
      type: "start_conversation",
      status: "running",
      payloadJson: {}
    });
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
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "job_existing",
          status: "running"
        }),
        expect.objectContaining({
          type: "start_conversation",
          status: "queued",
          conversationId: conversation.id
        })
      ])
    );
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
      worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo",
      runtimeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
    });
    expect((await db.conversation.findMany())[0]).toMatchObject({
      id: conversation.id,
      status: "running",
      branchName: "abitat/bugfix/abc123-fix-a-useful-page",
      worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo",
      runtimeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
    });
  });

  it("changes a conversation label between in process and complete", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Launch checklist"
    });

    await expect(
      service.setConversationLabel(conversation.id, {
        label: "complete",
        userId: "user_demo"
      })
    ).resolves.toMatchObject({ status: "pushed" });
    await expect(
      service.setConversationLabel(conversation.id, {
        label: "in_process",
        userId: "user_demo"
      })
    ).resolves.toMatchObject({ status: "running" });
  });

  it("marks the linked to-do complete when a conversation is labeled complete", async () => {
    const db = createConversationDb();
    const todoStoreSpy = createTodoStoreSpy();
    const service = createConversationQueueService(db, { todoStore: todoStoreSpy.store });
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Launch checklist"
    });

    await service.setConversationLabel(conversation.id, {
      label: "complete",
      userId: "user_demo"
    });

    expect(todoStoreSpy.completedConversationIds).toEqual([conversation.id]);
  });

  it("deletes a conversation after checking workspace membership", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Remove me"
    });

    await expect(
      service.deleteConversation(conversation.id, { userId: "user_demo" })
    ).resolves.toEqual({ ok: true });
    await expect(
      db.conversation.findUnique({ where: { id: conversation.id } })
    ).resolves.toBeNull();
  });

  it("cancels active daemon jobs before deleting a conversation", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Remove me"
    });

    await expect(
      service.deleteConversation(conversation.id, { userId: "user_demo" })
    ).resolves.toEqual({ ok: true });

    expect((await db.daemonJob.findMany())[0]).toMatchObject({
      status: "cancelled",
      errorMessage: "Deleted by user_demo"
    });
  });

  it("continues an existing conversation on its stored runtime session", async () => {
    const db = createConversationDb();
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Create the first file."
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "awaiting_approval",
        branchName: "abitat/feature/abcdef12-create-the-first-file",
        worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo",
        runtimeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
      }
    });
    await db.daemonJob.update({
      where: { id: (await db.daemonJob.findMany())[0]?.id ?? "" },
      data: { status: "completed" }
    });

    const continued = await service.continueConversation(conversation.id, {
      prompt: "Continue by creating the second file.",
      userId: "user_demo"
    });
    const jobs = await db.daemonJob.findMany();

    expect(continued).toMatchObject({
      id: conversation.id,
      status: "queued",
      prompt: "Continue by creating the second file.",
      runtimeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
    });
    expect(jobs.at(-1)).toMatchObject({
      type: "start_conversation",
      status: "queued",
      conversationId: conversation.id,
      payloadJson: {
        resumeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce",
        worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo",
        branchName: "abitat/feature/abcdef12-create-the-first-file",
        prompt: "Continue by creating the second file."
      }
    });
  });

  it("continues a stored runtime session while another conversation is running", async () => {
    const db = createConversationDb({
      id: "job_existing",
      workspaceId: "workspace_demo",
      machineId: "machine_demo",
      conversationId: "conversation_other",
      projectId: "project_demo",
      type: "start_conversation",
      status: "running",
      payloadJson: {}
    });
    const service = createConversationQueueService(db);
    const conversation = await service.createConversation({
      workspaceId: "workspace_demo",
      projectId: "project_demo",
      agentId: "agent_demo",
      createdByUserId: "user_demo",
      type: "feature",
      prompt: "Create the first file."
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "awaiting_approval",
        branchName: "abitat/feature/abcdef12-create-the-first-file",
        worktreePath: "/tmp/AbitatWorkspace/worktrees/conversation_demo",
        runtimeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
      }
    });
    await db.daemonJob.update({
      where: { id: (await db.daemonJob.findMany())[1]?.id ?? "" },
      data: { status: "completed" }
    });

    await expect(
      service.continueConversation(conversation.id, {
        prompt: "Continue this thread.",
        userId: "user_demo"
      })
    ).resolves.toMatchObject({
      id: conversation.id,
      status: "queued",
      prompt: "Continue this thread."
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
      deleteConversation: async () => {
        throw databaseError;
      },
      recoverStaleJobs: async () => {
        throw databaseError;
      },
      setConversationLabel: async () => {
        throw databaseError;
      },
      continueConversation: async () => {
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

  it("does not recover any active conversations reported by the daemon", async () => {
    const db = createConversationDb();
    await db.conversation.create({
      data: {
        id: "conversation_one",
        workspaceId: "workspace_demo",
        projectId: "project_demo",
        agentId: "agent_demo",
        createdByUserId: "user_demo",
        type: "feature",
        status: "running",
        prompt: "First active thread."
      }
    });
    await db.conversation.create({
      data: {
        id: "conversation_two",
        workspaceId: "workspace_demo",
        projectId: "project_demo",
        agentId: "agent_demo",
        createdByUserId: "user_demo",
        type: "bugfix",
        status: "running",
        prompt: "Second active thread."
      }
    });
    await db.daemonJob.create({
      data: {
        id: "job_one",
        workspaceId: "workspace_demo",
        machineId: "machine_demo",
        conversationId: "conversation_one",
        projectId: "project_demo",
        type: "start_conversation",
        status: "running",
        payloadJson: {},
        updatedAt: new Date("2026-04-24T00:00:00.000Z")
      }
    });
    await db.daemonJob.create({
      data: {
        id: "job_two",
        workspaceId: "workspace_demo",
        machineId: "machine_demo",
        conversationId: "conversation_two",
        projectId: "project_demo",
        type: "start_conversation",
        status: "running",
        payloadJson: {},
        updatedAt: new Date("2026-04-24T00:00:00.000Z")
      }
    });
    const service = createConversationQueueService(db);

    await expect(
      service.recoverStaleJobs("machine_demo", {
        activeConversationIds: ["conversation_one", "conversation_two"],
        now: new Date("2026-04-24T00:05:01.000Z"),
        staleAfterMs: 300_000
      })
    ).resolves.toBe(0);
    expect(await db.conversation.findMany()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "conversation_one", status: "running" }),
        expect.objectContaining({ id: "conversation_two", status: "running" })
      ])
    );
  });
});
