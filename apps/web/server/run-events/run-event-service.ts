import { randomBytes } from "node:crypto";

import {
  runEventIngestRequestSchema,
  type RunEventIngestRequest,
  type RunEventType
} from "@abitat/shared";

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
      return db.runEvent.create({
        data: {
          id: `event_${randomBytes(8).toString("hex")}`,
          conversationId,
          sequence: parsed.sequence,
          type: parsed.type,
          content: parsed.content,
          metadataJson: parsed.metadata
        }
      });
    },

    async listEvents(conversationId: string) {
      const events = await db.runEvent.findMany({ where: { conversationId } });
      return events.sort((left, right) => left.sequence - right.sequence);
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
