import type { Prisma, PrismaClient } from "@prisma/client";
import type { RunEventType } from "@abitat/shared";

import { prisma } from "../db/client";
import {
  createResilientRunEventService,
  createRunEventService,
  type RunEventRecord
} from "./run-event-service";

export const runEventService = createResilientRunEventService(
  createRunEventService(createPrismaRunEventDb(prisma)),
  createRunEventService(createDemoRunEventDb())
);

function createPrismaRunEventDb(db: PrismaClient) {
  return {
    runEvent: {
      async create(args: { data: RunEventRecord }) {
        return normalizeRunEvent(
          await db.runEvent.create({ data: args.data as Prisma.RunEventUncheckedCreateInput })
        );
      },
      async findMany(args: { where: { conversationId: string } }) {
        const events = await db.runEvent.findMany({
          where: args.where,
          orderBy: { sequence: "asc" }
        });

        return events.map(normalizeRunEvent);
      }
    }
  };
}

function normalizeRunEvent(event: {
  id: string;
  conversationId: string;
  sequence: number;
  type: RunEventType;
  content: string;
  metadataJson: Prisma.JsonValue;
  createdAt: Date;
}): RunEventRecord {
  return {
    id: event.id,
    conversationId: event.conversationId,
    sequence: event.sequence,
    type: event.type,
    content: event.content,
    metadataJson:
      event.metadataJson &&
      typeof event.metadataJson === "object" &&
      !Array.isArray(event.metadataJson)
        ? (event.metadataJson as Record<string, unknown>)
        : {},
    createdAt: event.createdAt
  };
}

function createDemoRunEventDb() {
  const store = getDemoRunEventStore();

  return {
    runEvent: {
      create: async ({ data }: { data: RunEventRecord }) => {
        store.events.set(data.id, data);
        return data;
      },
      findMany: async ({ where }: { where: { conversationId: string } }) =>
        Array.from(store.events.values())
          .filter((event) => event.conversationId === where.conversationId)
          .sort((left, right) => left.sequence - right.sequence)
    }
  };
}

function getDemoRunEventStore() {
  const globalForRunEvents = globalThis as typeof globalThis & {
    abitatDemoRunEventStore?: {
      events: Map<string, RunEventRecord>;
    };
  };

  globalForRunEvents.abitatDemoRunEventStore ??= {
    events: new Map<string, RunEventRecord>()
  };

  return globalForRunEvents.abitatDemoRunEventStore;
}
