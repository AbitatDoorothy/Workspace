import { randomBytes } from "node:crypto";

import type { RemoteControlStatus, RemoteControlSignal } from "@abitat/shared";

export interface RemoteControlSessionRecord {
  id: string;
  workspaceId: string;
  hostMachineId: string;
  clientMachineId: string;
  createdByUserId: string;
  status: RemoteControlStatus;
  screenEnabled: boolean;
  inputEnabled: boolean;
  startedAt?: Date | null;
  endedAt?: Date | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RemoteControlSignalRecord {
  id: string;
  sessionId: string;
  senderMachineId: string;
  recipientMachineId?: string | null;
  type: string;
  payloadJson: Record<string, unknown>;
  createdAt: Date;
}

interface RemoteControlDb {
  remoteControlSession: {
    create(args: { data: RemoteControlSessionRecord }): Promise<RemoteControlSessionRecord>;
    findFirst(args: {
      where: Partial<RemoteControlSessionRecord>;
    }): Promise<RemoteControlSessionRecord | null>;
    findMany(args: {
      where: Partial<RemoteControlSessionRecord>;
    }): Promise<RemoteControlSessionRecord[]>;
    findUnique(args: { where: { id: string } }): Promise<RemoteControlSessionRecord | null>;
    update(args: {
      where: { id: string };
      data: Partial<RemoteControlSessionRecord>;
    }): Promise<RemoteControlSessionRecord>;
  };
  remoteControlSignal: {
    create(args: { data: RemoteControlSignalRecord }): Promise<RemoteControlSignalRecord>;
    findMany(args: {
      where: { sessionId: string; recipientMachineId?: string };
    }): Promise<RemoteControlSignalRecord[]>;
  };
}

interface CreateSessionInput {
  workspaceId: string;
  hostMachineId: string;
  clientMachineId: string;
  createdByUserId: string;
  screenEnabled: boolean;
  inputEnabled: boolean;
}

interface RemoteControlServiceOptions {
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
}

const hostPollStatuses = new Set<RemoteControlStatus>([
  "requested",
  "connecting",
  "active",
  "ended",
  "failed"
]);

export function createRemoteControlService(
  db: RemoteControlDb,
  options: RemoteControlServiceOptions = {}
) {
  const idGenerator =
    options.idGenerator ?? ((prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`);
  const now = options.now ?? (() => new Date());

  return {
    async createSession(input: CreateSessionInput) {
      const existing = await db.remoteControlSession.findFirst({
        where: {
          hostMachineId: input.hostMachineId,
          status: "active"
        }
      });
      const requested = await db.remoteControlSession.findFirst({
        where: {
          hostMachineId: input.hostMachineId,
          status: "requested"
        }
      });
      const connecting = await db.remoteControlSession.findFirst({
        where: {
          hostMachineId: input.hostMachineId,
          status: "connecting"
        }
      });

      if (existing || requested || connecting) {
        throw new Error("Host already has an active remote-control session");
      }

      const createdAt = now();
      return db.remoteControlSession.create({
        data: {
          id: idGenerator("remote"),
          workspaceId: input.workspaceId,
          hostMachineId: input.hostMachineId,
          clientMachineId: input.clientMachineId,
          createdByUserId: input.createdByUserId,
          status: "requested",
          screenEnabled: input.screenEnabled,
          inputEnabled: input.inputEnabled,
          startedAt: null,
          endedAt: null,
          errorMessage: null,
          createdAt,
          updatedAt: createdAt
        }
      });
    },

    async pollHostSessions(hostMachineId: string) {
      const sessions = await Promise.all(
        Array.from(hostPollStatuses).map((status) =>
          db.remoteControlSession.findMany({ where: { hostMachineId, status } })
        )
      );

      return sessions
        .flat()
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    },

    async updateSessionStatus(
      sessionId: string,
      status: RemoteControlStatus,
      errorMessage?: string
    ) {
      const timestamp = now();
      return db.remoteControlSession.update({
        where: { id: sessionId },
        data: {
          status,
          updatedAt: timestamp,
          ...(status === "active" ? { startedAt: timestamp } : {}),
          ...(status === "ended" || status === "failed" ? { endedAt: timestamp } : {}),
          ...(errorMessage ? { errorMessage } : {})
        }
      });
    },

    getSession(sessionId: string) {
      return db.remoteControlSession.findUnique({ where: { id: sessionId } });
    },

    addSignal(input: RemoteControlSignal) {
      return db.remoteControlSignal.create({
        data: {
          id: idGenerator("signal"),
          sessionId: input.sessionId,
          senderMachineId: input.senderMachineId,
          recipientMachineId: input.recipientMachineId ?? null,
          type: input.type,
          payloadJson: input.payload,
          createdAt: now()
        }
      });
    },

    async listSignals(sessionId: string, recipientMachineId?: string) {
      const signals = await db.remoteControlSignal.findMany({
        where: {
          sessionId,
          ...(recipientMachineId ? { recipientMachineId } : {})
        }
      });

      return signals.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    }
  };
}

export type RemoteControlService = ReturnType<typeof createRemoteControlService>;
