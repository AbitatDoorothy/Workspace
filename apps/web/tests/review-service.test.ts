import { describe, expect, it } from "vitest";

import { createReviewService } from "../server/reviews/review-service";

interface TestConversation {
  id: string;
  workspaceId: string;
  projectId: string;
  status: string;
  summary: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
}

interface TestChangeSet {
  id: string;
  conversationId: string;
  filesChangedJson: string[];
  diffText: string;
}

interface TestDaemonJob {
  id: string;
  workspaceId: string;
  projectId: string;
  conversationId: string;
  type: string;
  status: string;
  payloadJson: unknown;
}

function createReviewDb() {
  const conversation: TestConversation = {
    id: "conversation_demo",
    workspaceId: "workspace_demo",
    projectId: "project_demo",
    status: "running",
    summary: null,
    approvedByUserId: null,
    approvedAt: null
  };
  const changeSets = new Map<string, TestChangeSet>();
  const jobs = new Map<string, TestDaemonJob>();

  return {
    conversation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === conversation.id ? conversation : null,
      update: async ({ data }: { data: Partial<TestConversation> }) => {
        Object.assign(conversation, data);
        return conversation;
      }
    },
    changeSet: {
      upsert: async ({
        create,
        update
      }: {
        create: TestChangeSet;
        update: Partial<TestChangeSet>;
      }) => {
        const current = changeSets.get(create.conversationId);
        const next = current ? { ...current, ...update } : create;
        changeSets.set(create.conversationId, next);
        return next;
      },
      findUnique: async ({ where }: { where: { conversationId: string } }) =>
        changeSets.get(where.conversationId) ?? null
    },
    daemonJob: {
      create: async ({ data }: { data: TestDaemonJob }) => {
        jobs.set(data.id, data);
        return data;
      },
      findMany: async () => Array.from(jobs.values())
    }
  };
}

describe("review service", () => {
  it("stores a changeset and moves the conversation to awaiting approval", async () => {
    const db = createReviewDb();
    const service = createReviewService(db);

    await service.storeChangeSet("conversation_demo", {
      filesChanged: ["ABITAT_RUN_LOG.md"],
      diffText: "diff --git a/ABITAT_RUN_LOG.md b/ABITAT_RUN_LOG.md",
      summary: "Changed 1 file."
    });

    await expect(service.getChangeSet("conversation_demo")).resolves.toMatchObject({
      filesChangedJson: ["ABITAT_RUN_LOG.md"]
    });
  });

  it("records approval and queues commit_and_push", async () => {
    const db = createReviewDb();
    const service = createReviewService(db);

    await expect(
      service.approveConversation("conversation_demo", {
        approvalType: "commit_and_push",
        commitMessage: "feat: add mock run log",
        approvedByUserId: "user_demo"
      })
    ).resolves.toMatchObject({
      ok: true,
      status: "approved"
    });
    expect(await db.daemonJob.findMany()).toMatchObject([
      {
        conversationId: "conversation_demo",
        type: "commit_and_push",
        status: "queued",
        payloadJson: { commitMessage: "feat: add mock run log" }
      }
    ]);
    await expect(
      db.conversation.findUnique({ where: { id: "conversation_demo" } })
    ).resolves.toMatchObject({
      approvedByUserId: "user_demo",
      approvedAt: expect.any(Date)
    });
  });
});
