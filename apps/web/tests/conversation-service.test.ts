import { describe, expect, it } from "vitest";
import type { ConversationStatus } from "@abitat/shared";

import { createConversationQueueService } from "../server/conversations/conversation-queue-service";

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
}

type JobFindFirstArgs = {
  where: {
    status: { in: string[] };
    type?: string;
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
          (job) => where.status.in.includes(job.status) && (!where.type || job.type === where.type)
        ) ?? null,
      findMany: async () => Array.from(jobs.values()),
      update: async ({ where, data }: { where: { id: string }; data: Partial<TestDaemonJob> }) => {
        const current = jobs.get(where.id);

        if (!current) {
          throw new Error(`Missing job ${where.id}`);
        }

        const next = { ...current, ...data };
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

    await service.ackJob(job?.id ?? "", "running");
    expect((await db.conversation.findMany())[0]).toMatchObject({
      id: conversation.id,
      status: "running"
    });
  });
});
