import { randomBytes } from "node:crypto";

import { approvalRequestSchema } from "@abitat/shared";
import { z } from "zod";

export interface ConversationReviewRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  status: string;
  summary: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  branchName: string | null;
  worktreePath: string | null;
}

export interface ChangeSetRecord {
  id: string;
  conversationId: string;
  filesChangedJson: string[];
  diffText: string;
}

export interface DaemonJobRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  conversationId: string;
  type: string;
  status: string;
  payloadJson: unknown;
}

interface ReviewDb {
  conversation: {
    findUnique(args: { where: { id: string } }): Promise<ConversationReviewRecord | null>;
    update(args: {
      where: { id: string };
      data: Partial<
        Pick<ConversationReviewRecord, "approvedAt" | "approvedByUserId" | "status" | "summary">
      >;
    }): Promise<ConversationReviewRecord>;
  };
  changeSet: {
    upsert(args: {
      where: { conversationId: string };
      create: ChangeSetRecord;
      update: Partial<Pick<ChangeSetRecord, "diffText" | "filesChangedJson">>;
    }): Promise<ChangeSetRecord>;
    findUnique(args: { where: { conversationId: string } }): Promise<ChangeSetRecord | null>;
  };
  daemonJob: {
    create(args: { data: DaemonJobRecord }): Promise<DaemonJobRecord>;
  };
}

const storeChangeSetSchema = z.object({
  filesChanged: z.array(z.string().min(1)),
  diffText: z.string(),
  summary: z.string().min(1)
});

const approveConversationSchema = approvalRequestSchema.extend({
  approvedByUserId: z.string().min(1)
});

export function createReviewService(db: ReviewDb) {
  return {
    async storeChangeSet(conversationId: string, input: z.infer<typeof storeChangeSetSchema>) {
      const parsed = storeChangeSetSchema.parse(input);
      const conversation = await requireConversation(db, conversationId);
      const changeSet = await db.changeSet.upsert({
        where: { conversationId },
        create: {
          id: `changeset_${randomBytes(8).toString("hex")}`,
          conversationId,
          filesChangedJson: parsed.filesChanged,
          diffText: parsed.diffText
        },
        update: {
          filesChangedJson: parsed.filesChanged,
          diffText: parsed.diffText
        }
      });

      await db.conversation.update({
        where: { id: conversation.id },
        data: {
          status: "awaiting_approval",
          summary: parsed.summary
        }
      });

      return changeSet;
    },

    getChangeSet(conversationId: string) {
      return db.changeSet.findUnique({ where: { conversationId } });
    },

    async approveConversation(
      conversationId: string,
      input: z.infer<typeof approveConversationSchema>
    ) {
      const parsed = approveConversationSchema.parse(input);
      const conversation = await requireConversation(db, conversationId);

      if (!conversation.branchName || !conversation.worktreePath) {
        throw new Error("Conversation is missing git worktree metadata");
      }

      await db.conversation.update({
        where: { id: conversationId },
        data: {
          approvedByUserId: parsed.approvedByUserId,
          approvedAt: new Date(),
          status: "approved"
        }
      });
      await db.daemonJob.create({
        data: {
          id: `job_${randomBytes(8).toString("hex")}`,
          workspaceId: conversation.workspaceId,
          projectId: conversation.projectId,
          conversationId,
          type: "commit_and_push",
          status: "queued",
          payloadJson: {
            commitMessage: parsed.commitMessage,
            branchName: conversation.branchName,
            worktreePath: conversation.worktreePath
          }
        }
      });

      return {
        ok: true as const,
        status: "approved" as const
      };
    }
  };
}

async function requireConversation(db: ReviewDb, conversationId: string) {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return conversation;
}

export type ReviewService = ReturnType<typeof createReviewService>;
