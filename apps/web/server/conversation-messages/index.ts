import type { Prisma, PrismaClient } from "@prisma/client";
import type { ConversationMessageRole } from "@abitat/shared";

import { prisma } from "../db/client";
import {
  createConversationMessageService,
  type ConversationMessageRecord
} from "./conversation-message-service";

export const conversationMessageService = createConversationMessageService(
  createPrismaConversationMessageDb(prisma)
);

function createPrismaConversationMessageDb(db: PrismaClient) {
  return {
    conversationMessage: {
      async create(args: { data: ConversationMessageRecord }) {
        return normalizeMessage(
          await db.conversationMessage.create({
            data: args.data as Prisma.ConversationMessageUncheckedCreateInput
          })
        );
      },
      async findFirst(args: {
        where: Partial<ConversationMessageRecord>;
        orderBy?: { sequence: "desc" };
      }) {
        const message = await db.conversationMessage.findFirst({
          where: args.where as Prisma.ConversationMessageWhereInput,
          orderBy: args.orderBy
        });

        return message ? normalizeMessage(message) : null;
      },
      async findMany(args: { where: { conversationId: string; sequence?: { gt: number } } }) {
        const messages = await db.conversationMessage.findMany({
          where: args.where,
          orderBy: { sequence: "asc" }
        });

        return messages.map(normalizeMessage);
      }
    }
  };
}

function normalizeMessage(message: {
  id: string;
  conversationId: string;
  sequence: number;
  role: ConversationMessageRole;
  sourceDeviceId: string | null;
  clientMessageId: string | null;
  content: string;
  metadataJson: Prisma.JsonValue;
  createdAt: Date;
}): ConversationMessageRecord {
  return {
    id: message.id,
    conversationId: message.conversationId,
    sequence: message.sequence,
    role: message.role,
    sourceDeviceId: message.sourceDeviceId,
    clientMessageId: message.clientMessageId,
    content: message.content,
    metadataJson:
      message.metadataJson &&
      typeof message.metadataJson === "object" &&
      !Array.isArray(message.metadataJson)
        ? (message.metadataJson as Record<string, unknown>)
        : {},
    createdAt: message.createdAt
  };
}
