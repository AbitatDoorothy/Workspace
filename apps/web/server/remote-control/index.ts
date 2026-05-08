import type { Prisma, PrismaClient } from "@prisma/client";
import type { RemoteControlStatus } from "@abitat_reece/shared";

import { prisma } from "../db/client";
import {
  createRemoteControlService,
  type RemoteControlSessionRecord,
  type RemoteControlSignalRecord
} from "./remote-control-service";

export const remoteControlService = createRemoteControlService(createPrismaRemoteControlDb(prisma));

function createPrismaRemoteControlDb(db: PrismaClient) {
  return {
    remoteControlSession: {
      async create(args: { data: RemoteControlSessionRecord }) {
        return normalizeSession(
          await db.remoteControlSession.create({
            data: args.data as Prisma.RemoteControlSessionUncheckedCreateInput
          })
        );
      },
      async findFirst(args: { where: Partial<RemoteControlSessionRecord> }) {
        const session = await db.remoteControlSession.findFirst({
          where: args.where as Prisma.RemoteControlSessionWhereInput,
          orderBy: { createdAt: "asc" }
        });

        return session ? normalizeSession(session) : null;
      },
      async findMany(args: { where: Partial<RemoteControlSessionRecord> }) {
        const sessions = await db.remoteControlSession.findMany({
          where: args.where as Prisma.RemoteControlSessionWhereInput,
          orderBy: { createdAt: "asc" }
        });

        return sessions.map(normalizeSession);
      },
      async findUnique(args: { where: { id: string } }) {
        const session = await db.remoteControlSession.findUnique({ where: args.where });
        return session ? normalizeSession(session) : null;
      },
      async update(args: { where: { id: string }; data: Partial<RemoteControlSessionRecord> }) {
        return normalizeSession(
          await db.remoteControlSession.update({
            where: args.where,
            data: args.data as Prisma.RemoteControlSessionUncheckedUpdateInput
          })
        );
      }
    },
    remoteControlSignal: {
      async create(args: { data: RemoteControlSignalRecord }) {
        return normalizeSignal(
          await db.remoteControlSignal.create({
            data: args.data as Prisma.RemoteControlSignalUncheckedCreateInput
          })
        );
      },
      async findMany(args: { where: { sessionId: string; recipientMachineId?: string } }) {
        const signals = await db.remoteControlSignal.findMany({
          where: args.where,
          orderBy: { createdAt: "asc" }
        });

        return signals.map(normalizeSignal);
      }
    }
  };
}

function normalizeSession(session: {
  id: string;
  workspaceId: string;
  hostMachineId: string;
  clientMachineId: string;
  createdByUserId: string;
  status: RemoteControlStatus;
  screenEnabled: boolean;
  inputEnabled: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RemoteControlSessionRecord {
  return session;
}

function normalizeSignal(signal: {
  id: string;
  sessionId: string;
  senderMachineId: string;
  recipientMachineId: string | null;
  type: string;
  payloadJson: Prisma.JsonValue;
  createdAt: Date;
}): RemoteControlSignalRecord {
  return {
    id: signal.id,
    sessionId: signal.sessionId,
    senderMachineId: signal.senderMachineId,
    recipientMachineId: signal.recipientMachineId,
    type: signal.type,
    payloadJson:
      signal.payloadJson &&
      typeof signal.payloadJson === "object" &&
      !Array.isArray(signal.payloadJson)
        ? (signal.payloadJson as Record<string, unknown>)
        : {},
    createdAt: signal.createdAt
  };
}
