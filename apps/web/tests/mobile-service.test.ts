import { describe, expect, it } from "vitest";

import { createMobileService, hashMobileToken } from "../server/mobile/mobile-service";

interface TestMachine {
  id: string;
  workspaceId: string;
  name: string;
  type: "host" | "client";
  status: string;
  tokenHash?: string | null;
  pairingTokenHash?: string | null;
  ownerUserId?: string | null;
  platform?: string | null;
  deviceKind?: string | null;
  publicKey?: string | null;
  pairedHostMachineId?: string | null;
  capabilitiesJson?: unknown;
  lastSeenAt?: Date | null;
}

interface TestPairing {
  id: string;
  workspaceId: string;
  hostMachineId: string;
  createdByUserId: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt?: Date | null;
  approvedAt?: Date | null;
  createdAt: Date;
}

interface TestProject {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  hostLocalPath?: string | null;
  repoSyncStatus: string;
}

function createMobileDb() {
  const machines = new Map<string, TestMachine>();
  const pairings = new Map<string, TestPairing>();
  const projects = new Map<string, TestProject>();
  const workspace = { id: "workspace_demo", name: "Demo Workspace" };

  machines.set("machine_demo", {
    id: "machine_demo",
    workspaceId: "workspace_demo",
    name: "Demo Host",
    type: "host",
    status: "online",
    pairingTokenHash: "host-token"
  });
  projects.set("project_demo", {
    id: "project_demo",
    workspaceId: "workspace_demo",
    name: "Workspace",
    repoUrl: "/Users/reece/Desktop/Test",
    hostLocalPath: "/Users/reece/Desktop/Test",
    repoSyncStatus: "ready"
  });

  return {
    machine: {
      create: async ({ data }: { data: TestMachine }) => {
        machines.set(data.id, data);
        return data;
      },
      findFirst: async ({ where }: { where: Partial<TestMachine> }) =>
        [...machines.values()].find((machine) =>
          Object.entries(where).every(([key, value]) => machine[key as keyof TestMachine] === value)
        ) ?? null,
      findMany: async ({ where }: { where: Partial<TestMachine> }) =>
        [...machines.values()].filter((machine) =>
          Object.entries(where).every(([key, value]) => machine[key as keyof TestMachine] === value)
        ),
      findUnique: async ({ where }: { where: { id: string } }) => machines.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<TestMachine> }) => {
        const current = machines.get(where.id);
        if (!current) {
          throw new Error(`Missing machine ${where.id}`);
        }
        const next = { ...current, ...data };
        machines.set(where.id, next);
        return next;
      }
    },
    devicePairing: {
      create: async ({ data }: { data: TestPairing }) => {
        pairings.set(data.id, data);
        return data;
      },
      findFirst: async ({ where }: { where: Partial<TestPairing> }) =>
        [...pairings.values()].find((pairing) =>
          Object.entries(where).every(([key, value]) => pairing[key as keyof TestPairing] === value)
        ) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<TestPairing> }) => {
        const current = pairings.get(where.id);
        if (!current) {
          throw new Error(`Missing pairing ${where.id}`);
        }
        const next = { ...current, ...data };
        pairings.set(where.id, next);
        return next;
      }
    },
    project: {
      findMany: async ({ where }: { where: { workspaceId: string } }) =>
        [...projects.values()].filter((project) => project.workspaceId === where.workspaceId)
    },
    workspace: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === workspace.id ? workspace : null
    },
    state: { machines, pairings, projects }
  };
}

describe("mobile service", () => {
  it("creates a single-use phone pairing code and pairs a phone to the host", async () => {
    const db = createMobileDb();
    const service = createMobileService(db, {
      codeGenerator: () => "ABITAT-654321",
      idGenerator: (prefix) => `${prefix}_test`,
      tokenGenerator: () => "client_secret",
      now: () => new Date("2026-05-03T10:00:00.000Z")
    });

    const pairing = await service.createPhonePairing({
      workspaceId: "workspace_demo",
      hostMachineId: "machine_demo",
      createdByUserId: "user_demo"
    });

    expect(pairing).toMatchObject({
      code: "ABITAT-654321",
      qrPayload: "abitat://pair?code=ABITAT-654321"
    });

    const paired = await service.completePhonePairing({
      code: "ABITAT-654321",
      deviceName: "Reece iPhone",
      platform: "ios",
      appVersion: "1.0.0",
      publicKey: "phone-key"
    });

    expect(paired).toEqual({
      machineId: "machine_test",
      workspaceId: "workspace_demo",
      hostMachineId: "machine_demo",
      clientToken: "client_secret"
    });
    expect(await service.verifyMobileToken("machine_test", "client_secret")).toBe(true);
    await expect(
      service.completePhonePairing({
        code: "ABITAT-654321",
        deviceName: "Other iPhone",
        platform: "ios",
        appVersion: "1.0.0"
      })
    ).rejects.toThrow("Pairing code has already been used");
  });

  it("rejects expired pairing codes", async () => {
    const db = createMobileDb();
    const service = createMobileService(db, {
      codeGenerator: () => "ABITAT-000001",
      now: () => new Date("2026-05-03T10:00:00.000Z")
    });

    await service.createPhonePairing({
      workspaceId: "workspace_demo",
      hostMachineId: "machine_demo",
      createdByUserId: "user_demo",
      ttlMs: 1000
    });

    const expiredService = createMobileService(db, {
      now: () => new Date("2026-05-03T10:00:02.000Z")
    });

    await expect(
      expiredService.completePhonePairing({
        code: "ABITAT-000001",
        deviceName: "Reece iPhone",
        platform: "ios",
        appVersion: "1.0.0"
      })
    ).rejects.toThrow("Pairing code has expired");
  });

  it("returns bootstrap and project data scoped to the paired phone workspace", async () => {
    const db = createMobileDb();
    db.state.machines.set("machine_phone", {
      id: "machine_phone",
      workspaceId: "workspace_demo",
      name: "Reece iPhone",
      type: "client",
      status: "online",
      tokenHash: hashMobileToken("client_secret"),
      pairedHostMachineId: "machine_demo",
      deviceKind: "phone",
      platform: "ios"
    });
    const service = createMobileService(db);

    const actor = await service.requireMobileActor("client_secret");

    await expect(service.bootstrap(actor)).resolves.toMatchObject({
      workspace: { id: "workspace_demo" },
      phone: { id: "machine_phone" },
      host: { id: "machine_demo" }
    });
    await expect(service.listProjects(actor)).resolves.toEqual([
      expect.objectContaining({
        id: "project_demo",
        hostLocalPath: "/Users/reece/Desktop/Test"
      })
    ]);
  });

  it("registers Expo push tokens on the paired phone and lists them for the paired host", async () => {
    const db = createMobileDb();
    db.state.machines.set("machine_phone", {
      id: "machine_phone",
      workspaceId: "workspace_demo",
      name: "Reece iPhone",
      type: "client",
      status: "online",
      tokenHash: hashMobileToken("client_secret"),
      pairedHostMachineId: "machine_demo",
      deviceKind: "phone",
      platform: "ios",
      capabilitiesJson: ["mobile_chat", "remote_control"]
    });
    const service = createMobileService(db, {
      now: () => new Date("2026-05-05T10:30:00.000Z")
    });
    const actor = await service.requireMobileActor("client_secret");

    await expect(
      service.registerPushToken(actor, {
        platform: "ios",
        provider: "expo",
        token: "ExpoPushToken[test-token]"
      })
    ).resolves.toEqual({
      platform: "ios",
      provider: "expo",
      token: "ExpoPushToken[test-token]"
    });

    await service.registerPushToken(actor, {
      platform: "ios",
      provider: "expo",
      token: "ExpoPushToken[test-token]"
    });

    await expect(
      service.listPushSubscriptionsForHost({
        hostMachineId: "machine_demo",
        workspaceId: "workspace_demo"
      })
    ).resolves.toEqual([
      {
        machineId: "machine_phone",
        platform: "ios",
        provider: "expo",
        token: "ExpoPushToken[test-token]"
      }
    ]);
    expect(db.state.machines.get("machine_phone")?.capabilitiesJson).toMatchObject({
      features: ["mobile_chat", "remote_control"],
      pushSubscriptions: [
        expect.objectContaining({
          token: "ExpoPushToken[test-token]"
        })
      ]
    });
  });

  it("rejects unsupported mobile push tokens", async () => {
    const db = createMobileDb();
    db.state.machines.set("machine_phone", {
      id: "machine_phone",
      workspaceId: "workspace_demo",
      name: "Reece iPhone",
      type: "client",
      status: "online",
      tokenHash: hashMobileToken("client_secret"),
      pairedHostMachineId: "machine_demo",
      deviceKind: "phone",
      platform: "ios"
    });
    const service = createMobileService(db);
    const actor = await service.requireMobileActor("client_secret");

    await expect(
      service.registerPushToken(actor, {
        platform: "ios",
        provider: "expo",
        token: "not-a-push-token"
      })
    ).rejects.toThrow("Invalid Expo push token");
  });

  it("records push registration diagnostics on the paired phone", async () => {
    const db = createMobileDb();
    db.state.machines.set("machine_phone", {
      id: "machine_phone",
      workspaceId: "workspace_demo",
      name: "Reece iPhone",
      type: "client",
      status: "online",
      tokenHash: hashMobileToken("client_secret"),
      pairedHostMachineId: "machine_demo",
      deviceKind: "phone",
      platform: "ios",
      capabilitiesJson: ["mobile_chat", "remote_control"]
    });
    const service = createMobileService(db, {
      now: () => new Date("2026-05-05T10:45:00.000Z")
    });
    const actor = await service.requireMobileActor("client_secret");

    await expect(
      service.recordPushRegistrationDiagnostic(actor, {
        message: "Expo push token request timed out after 10 seconds",
        stage: "expo-token"
      })
    ).resolves.toEqual({
      message: "Expo push token request timed out after 10 seconds",
      reportedAt: "2026-05-05T10:45:00.000Z",
      stage: "expo-token"
    });

    expect(db.state.machines.get("machine_phone")?.capabilitiesJson).toMatchObject({
      features: ["mobile_chat", "remote_control"],
      lastPushRegistrationDiagnostic: {
        message: "Expo push token request timed out after 10 seconds",
        reportedAt: "2026-05-05T10:45:00.000Z",
        stage: "expo-token"
      },
      pushSubscriptions: []
    });
  });
});
