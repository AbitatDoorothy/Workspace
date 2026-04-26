import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../db/client";
import {
  createReviewService,
  type ChangeSetRecord,
  type ConversationReviewRecord,
  type DaemonJobRecord
} from "./review-service";

export const reviewService = createResilientReviewService(
  createReviewService(createPrismaReviewDb(prisma)),
  createReviewService(createDemoReviewDb())
);

function createPrismaReviewDb(db: PrismaClient) {
  return {
    conversation: {
      async findUnique(args: { where: { id: string } }) {
        const conversation = await db.conversation.findUnique({ where: args.where });
        return conversation ? normalizeConversation(conversation) : null;
      },
      async update(args: {
        where: { id: string };
        data: Partial<
          Pick<ConversationReviewRecord, "approvedAt" | "approvedByUserId" | "status" | "summary">
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
    changeSet: {
      async upsert(args: {
        where: { conversationId: string };
        create: ChangeSetRecord;
        update: Partial<Pick<ChangeSetRecord, "diffText" | "filesChangedJson">>;
      }) {
        return normalizeChangeSet(
          await db.changeSet.upsert({
            where: args.where,
            create: args.create as Prisma.ChangeSetUncheckedCreateInput,
            update: args.update as Prisma.ChangeSetUncheckedUpdateInput
          })
        );
      },
      async findUnique(args: { where: { conversationId: string } }) {
        const changeSet = await db.changeSet.findUnique({ where: args.where });
        return changeSet ? normalizeChangeSet(changeSet) : null;
      }
    },
    daemonJob: {
      async create(args: { data: DaemonJobRecord }) {
        return normalizeDaemonJob(
          await db.daemonJob.create({ data: args.data as Prisma.DaemonJobUncheckedCreateInput })
        );
      }
    }
  };
}

function createResilientReviewService(primary: ReviewServiceLike, fallback: ReviewServiceLike) {
  return {
    storeChangeSet(
      conversationId: string,
      input: Parameters<ReviewServiceLike["storeChangeSet"]>[1]
    ) {
      return runWithFallback(
        () => primary.storeChangeSet(conversationId, input),
        () => fallback.storeChangeSet(conversationId, input)
      );
    },
    getChangeSet(conversationId: string) {
      return runWithFallback(
        () => primary.getChangeSet(conversationId),
        () => fallback.getChangeSet(conversationId)
      );
    },
    approveConversation(
      conversationId: string,
      input: Parameters<ReviewServiceLike["approveConversation"]>[1]
    ) {
      return runWithFallback(
        () => primary.approveConversation(conversationId, input),
        () => fallback.approveConversation(conversationId, input)
      );
    }
  };
}

type ReviewServiceLike = ReturnType<typeof createReviewService>;

async function runWithFallback<TResult>(
  primary: () => Promise<TResult>,
  fallback: () => Promise<TResult>
) {
  try {
    return await primary();
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "";

    if (code !== "ECONNREFUSED" && !message.includes("ECONNREFUSED")) {
      throw error;
    }

    return fallback();
  }
}

function normalizeConversation(conversation: {
  id: string;
  workspaceId: string;
  projectId: string;
  status: string;
  summary: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  branchName: string | null;
  worktreePath: string | null;
}): ConversationReviewRecord {
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    projectId: conversation.projectId,
    status: conversation.status,
    summary: conversation.summary,
    approvedByUserId: conversation.approvedByUserId,
    approvedAt: conversation.approvedAt,
    branchName: conversation.branchName,
    worktreePath: conversation.worktreePath
  };
}

function normalizeChangeSet(changeSet: {
  id: string;
  conversationId: string;
  filesChangedJson: Prisma.JsonValue;
  diffText: string;
}): ChangeSetRecord {
  return {
    id: changeSet.id,
    conversationId: changeSet.conversationId,
    filesChangedJson: Array.isArray(changeSet.filesChangedJson)
      ? changeSet.filesChangedJson.filter((file): file is string => typeof file === "string")
      : [],
    diffText: changeSet.diffText
  };
}

function normalizeDaemonJob(job: {
  id: string;
  workspaceId: string;
  projectId: string | null;
  conversationId: string | null;
  type: string;
  status: string;
  payloadJson: Prisma.JsonValue;
}): DaemonJobRecord {
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    projectId: job.projectId ?? "",
    conversationId: job.conversationId ?? "",
    type: job.type,
    status: job.status,
    payloadJson: job.payloadJson
  };
}

function createDemoReviewDb() {
  const store = getDemoReviewStore();

  return {
    conversation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.conversations.get(where.id) ?? {
          id: where.id,
          workspaceId: "workspace_demo",
          projectId: "project_demo",
          status: "running",
          summary: null,
          approvedByUserId: null,
          approvedAt: null,
          branchName: null,
          worktreePath: null
        },
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<
          Pick<ConversationReviewRecord, "approvedAt" | "approvedByUserId" | "status" | "summary">
        >;
      }) => {
        const current = store.conversations.get(where.id) ?? {
          id: where.id,
          workspaceId: "workspace_demo",
          projectId: "project_demo",
          status: "running",
          summary: null,
          approvedByUserId: null,
          approvedAt: null,
          branchName: null,
          worktreePath: null
        };
        const next = { ...current, ...data };
        store.conversations.set(where.id, next);
        return next;
      }
    },
    changeSet: {
      upsert: async ({
        create,
        update
      }: {
        where: { conversationId: string };
        create: ChangeSetRecord;
        update: Partial<Pick<ChangeSetRecord, "diffText" | "filesChangedJson">>;
      }) => {
        const current = store.changeSets.get(create.conversationId);
        const next = current ? { ...current, ...update } : create;
        store.changeSets.set(create.conversationId, next);
        return next;
      },
      findUnique: async ({ where }: { where: { conversationId: string } }) =>
        store.changeSets.get(where.conversationId) ?? null
    },
    daemonJob: {
      create: async ({ data }: { data: DaemonJobRecord }) => {
        store.jobs.set(data.id, data);
        return data;
      }
    }
  };
}

function getDemoReviewStore() {
  const globalForReviews = globalThis as typeof globalThis & {
    abitatDemoReviewStore?: {
      conversations: Map<string, ConversationReviewRecord>;
      changeSets: Map<string, ChangeSetRecord>;
      jobs: Map<string, DaemonJobRecord>;
    };
  };

  globalForReviews.abitatDemoReviewStore ??= {
    conversations: new Map<string, ConversationReviewRecord>(),
    changeSets: new Map<string, ChangeSetRecord>(),
    jobs: new Map<string, DaemonJobRecord>()
  };

  return globalForReviews.abitatDemoReviewStore;
}
