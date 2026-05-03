import { describe, expect, it } from "vitest";

import { createRemoteControlService } from "../server/remote-control/remote-control-service";

interface TestRemoteSession {
  id: string;
  workspaceId: string;
  hostMachineId: string;
  clientMachineId: string;
  createdByUserId: string;
  status: "requested" | "connecting" | "active" | "ended" | "failed";
  screenEnabled: boolean;
  inputEnabled: boolean;
  startedAt?: Date | null;
  endedAt?: Date | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TestSignal {
  id: string;
  sessionId: string;
  senderMachineId: string;
  recipientMachineId?: string | null;
  type: string;
  payloadJson: Record<string, unknown>;
  createdAt: Date;
}

function createRemoteDb() {
  const sessions = new Map<string, TestRemoteSession>();
  const signals: TestSignal[] = [];

  return {
    remoteControlSession: {
      create: async ({ data }: { data: TestRemoteSession }) => {
        sessions.set(data.id, data);
        return data;
      },
      findFirst: async ({ where }: { where: Partial<TestRemoteSession> }) =>
        [...sessions.values()].find((session) =>
          Object.entries(where).every(
            ([key, value]) => session[key as keyof TestRemoteSession] === value
          )
        ) ?? null,
      findMany: async ({ where }: { where: Partial<TestRemoteSession> }) =>
        [...sessions.values()].filter((session) =>
          Object.entries(where).every(
            ([key, value]) => session[key as keyof TestRemoteSession] === value
          )
        ),
      findUnique: async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null,
      update: async ({
        data,
        where
      }: {
        data: Partial<TestRemoteSession>;
        where: { id: string };
      }) => {
        const current = sessions.get(where.id);
        if (!current) {
          throw new Error(`Missing remote session ${where.id}`);
        }
        const next = { ...current, ...data };
        sessions.set(where.id, next);
        return next;
      }
    },
    remoteControlSignal: {
      create: async ({ data }: { data: TestSignal }) => {
        signals.push(data);
        return data;
      },
      findMany: async ({ where }: { where: { sessionId: string; recipientMachineId?: string } }) =>
        signals
          .filter(
            (signal) =>
              signal.sessionId === where.sessionId &&
              (!where.recipientMachineId || signal.recipientMachineId === where.recipientMachineId)
          )
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    },
    state: { sessions, signals }
  };
}

describe("remote control service", () => {
  it("creates one active control session per host", async () => {
    const db = createRemoteDb();
    const service = createRemoteControlService(db, {
      idGenerator: (prefix) => `${prefix}_test`,
      now: () => new Date("2026-05-03T10:00:00.000Z")
    });

    const session = await service.createSession({
      workspaceId: "workspace_demo",
      hostMachineId: "machine_demo",
      clientMachineId: "machine_phone",
      createdByUserId: "user_demo",
      screenEnabled: true,
      inputEnabled: true
    });

    expect(session).toMatchObject({
      id: "remote_test",
      status: "requested",
      hostMachineId: "machine_demo",
      clientMachineId: "machine_phone"
    });
    await expect(
      service.createSession({
        workspaceId: "workspace_demo",
        hostMachineId: "machine_demo",
        clientMachineId: "machine_phone_2",
        createdByUserId: "user_demo",
        screenEnabled: true,
        inputEnabled: true
      })
    ).rejects.toThrow("Host already has an active remote-control session");
  });

  it("polls requested sessions for the host and updates status", async () => {
    const db = createRemoteDb();
    const service = createRemoteControlService(db);
    const session = await service.createSession({
      workspaceId: "workspace_demo",
      hostMachineId: "machine_demo",
      clientMachineId: "machine_phone",
      createdByUserId: "user_demo",
      screenEnabled: true,
      inputEnabled: true
    });

    await expect(service.pollHostSessions("machine_demo")).resolves.toEqual([
      expect.objectContaining({ id: session.id })
    ]);
    await expect(service.updateSessionStatus(session.id, "active")).resolves.toMatchObject({
      status: "active",
      startedAt: expect.any(Date)
    });
    await expect(service.updateSessionStatus(session.id, "ended")).resolves.toMatchObject({
      status: "ended",
      endedAt: expect.any(Date)
    });
    await expect(service.pollHostSessions("machine_demo")).resolves.toEqual([
      expect.objectContaining({
        id: session.id,
        status: "ended"
      })
    ]);
  });

  it("stores and lists signaling messages by recipient", async () => {
    const db = createRemoteDb();
    const service = createRemoteControlService(db);
    const session = await service.createSession({
      workspaceId: "workspace_demo",
      hostMachineId: "machine_demo",
      clientMachineId: "machine_phone",
      createdByUserId: "user_demo",
      screenEnabled: true,
      inputEnabled: true
    });

    await service.addSignal({
      sessionId: session.id,
      senderMachineId: "machine_phone",
      recipientMachineId: "machine_demo",
      type: "offer",
      payload: { sdp: "v=0" }
    });

    await expect(service.listSignals(session.id, "machine_demo")).resolves.toEqual([
      expect.objectContaining({
        type: "offer",
        payloadJson: { sdp: "v=0" }
      })
    ]);
    await expect(service.listSignals(session.id, "machine_phone")).resolves.toEqual([]);
  });
});
