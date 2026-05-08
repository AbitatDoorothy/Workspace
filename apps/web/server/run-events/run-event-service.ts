import { randomBytes } from "node:crypto";

import {
  runEventIngestRequestSchema,
  type RunEventIngestRequest,
  type RunEventType
} from "@abitat_reece/shared";

export interface RunEventRecord {
  id: string;
  conversationId: string;
  sequence: number;
  type: RunEventType;
  content: string;
  metadataJson: Record<string, unknown>;
  createdAt?: Date;
}

interface RunEventDb {
  runEvent: {
    create(args: { data: RunEventRecord }): Promise<RunEventRecord>;
    findMany(args: { where: { conversationId: string } }): Promise<RunEventRecord[]>;
  };
}

export function createRunEventService(db: RunEventDb) {
  return {
    async ingestEvent(conversationId: string, input: RunEventIngestRequest) {
      const parsed = runEventIngestRequestSchema.parse(input);
      const events = await this.listEvents(conversationId);
      const latestSequence = events.reduce((max, event) => Math.max(max, event.sequence), 0);
      const usedSequences = new Set(events.map((event) => event.sequence));
      const sequence = usedSequences.has(parsed.sequence) ? latestSequence + 1 : parsed.sequence;

      return db.runEvent.create({
        data: {
          id: `event_${randomBytes(8).toString("hex")}`,
          conversationId,
          sequence,
          type: parsed.type,
          content: parsed.content,
          metadataJson: parsed.metadata
        }
      });
    },

    async listEvents(conversationId: string) {
      const events = await db.runEvent.findMany({ where: { conversationId } });
      return events.sort((left, right) => left.sequence - right.sequence);
    },

    async appendAuditEvent(
      conversationId: string,
      input: { content: string; metadata?: Record<string, unknown> }
    ) {
      const events = await this.listEvents(conversationId);
      const sequence = events.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;

      return this.ingestEvent(conversationId, {
        sequence,
        type: "approval",
        content: input.content,
        metadata: input.metadata ?? {}
      });
    }
  };
}

export type RunEventService = ReturnType<typeof createRunEventService>;

export function createResilientRunEventService(
  primary: RunEventService,
  fallback: RunEventService
): RunEventService {
  return {
    ingestEvent(conversationId, input) {
      return runWithFallback(
        () => primary.ingestEvent(conversationId, input),
        () => fallback.ingestEvent(conversationId, input)
      );
    },

    listEvents(conversationId) {
      return runWithFallback(
        () => primary.listEvents(conversationId),
        () => fallback.listEvents(conversationId)
      );
    },

    appendAuditEvent(conversationId, input) {
      return runWithFallback(
        () => primary.appendAuditEvent(conversationId, input),
        () => fallback.appendAuditEvent(conversationId, input)
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
