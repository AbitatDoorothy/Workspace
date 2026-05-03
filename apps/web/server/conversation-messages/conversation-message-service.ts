import { randomBytes } from "node:crypto";

import {
  conversationMessageCreateRequestSchema,
  type ConversationMessageRole
} from "@abitat/shared";
import type { z } from "zod";

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  sequence: number;
  role: ConversationMessageRole;
  sourceDeviceId?: string | null;
  clientMessageId?: string | null;
  content: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
}

interface ConversationMessageDb {
  conversationMessage: {
    create(args: { data: ConversationMessageRecord }): Promise<ConversationMessageRecord>;
    findFirst(args: {
      where: Partial<ConversationMessageRecord>;
      orderBy?: { sequence: "desc" };
    }): Promise<ConversationMessageRecord | null>;
    findMany(args: {
      where: { conversationId: string; sequence?: { gt: number } };
    }): Promise<ConversationMessageRecord[]>;
  };
}

interface ConversationMessageServiceOptions {
  idGenerator?: () => string;
  now?: () => Date;
}

export function createConversationMessageService(
  db: ConversationMessageDb,
  options: ConversationMessageServiceOptions = {}
) {
  const idGenerator = options.idGenerator ?? (() => `message_${randomBytes(8).toString("hex")}`);
  const now = options.now ?? (() => new Date());

  return {
    async appendMessage(
      conversationId: string,
      input: z.input<typeof conversationMessageCreateRequestSchema>
    ) {
      const parsed = conversationMessageCreateRequestSchema.parse(input);

      if (parsed.clientMessageId) {
        const existing = await db.conversationMessage.findFirst({
          where: {
            conversationId,
            clientMessageId: parsed.clientMessageId
          }
        });

        if (existing) {
          return existing;
        }
      }

      const latest = await db.conversationMessage.findFirst({
        where: { conversationId },
        orderBy: { sequence: "desc" }
      });
      const message: ConversationMessageRecord = {
        id: idGenerator(),
        conversationId,
        sequence: (latest?.sequence ?? 0) + 1,
        role: parsed.role,
        sourceDeviceId: parsed.sourceDeviceId ?? null,
        clientMessageId: parsed.clientMessageId ?? null,
        content: parsed.content,
        metadataJson: parsed.metadata,
        createdAt: now()
      };

      return db.conversationMessage.create({ data: message });
    },

    async listMessages(conversationId: string, options: { afterSequence?: number } = {}) {
      const messages = await db.conversationMessage.findMany({
        where: {
          conversationId,
          ...(options.afterSequence ? { sequence: { gt: options.afterSequence } } : {})
        }
      });

      return messages.sort((left, right) => left.sequence - right.sequence);
    }
  };
}

export type ConversationMessageService = ReturnType<typeof createConversationMessageService>;
