import { describe, expect, it } from "vitest";

import {
  DEMO_PAIRING_CODE,
  createHostService,
  getHostPairingCode,
  hashHostToken
} from "../server/hosts/host-service";

interface TestMachine {
  id: string;
  workspaceId: string;
  name: string;
  status: string;
  type: string;
  pairingTokenHash: string | null;
  installedToolsJson: unknown;
  lastSeenAt: Date | null;
}

interface TestMachineFindUniqueArgs {
  where: {
    id: string;
  };
}

interface TestMachineUpdateArgs {
  where: {
    id: string;
  };
  data: Partial<TestMachine>;
}

function createHostDb() {
  const machines = new Map<string, TestMachine>();

  machines.set("machine_demo", {
    id: "machine_demo",
    workspaceId: "workspace_demo",
    name: "Demo Host",
    status: "pending",
    type: "host",
    pairingTokenHash: hashHostToken("existing-token"),
    installedToolsJson: null,
    lastSeenAt: null
  });

  return {
    machine: {
      findFirst: async (args?: { where?: Partial<TestMachine> }) => {
        if (!args?.where) {
          return machines.get("machine_demo") ?? null;
        }

        return (
          [...machines.values()].find((machine) =>
            Object.entries(args.where ?? {}).every(
              ([key, value]) => machine[key as keyof TestMachine] === value
            )
          ) ?? null
        );
      },
      findUnique: async ({ where }: TestMachineFindUniqueArgs) => machines.get(where.id) ?? null,
      update: async ({ where, data }: TestMachineUpdateArgs) => {
        const current = machines.get(where.id);

        if (!current) {
          throw new Error(`Missing machine ${where.id}`);
        }

        const next: TestMachine = { ...current, ...data };
        machines.set(where.id, next);
        return next;
      }
    }
  };
}

describe("host service", () => {
  it("pairs a demo host and stores only a host token hash", async () => {
    const service = createHostService(createHostDb());

    const result = await service.pairHost({
      pairingCode: DEMO_PAIRING_CODE,
      machineName: "Reece MacBook Pro",
      daemonVersion: "0.1.0"
    });

    expect(result.machineId).toBe("machine_demo");
    expect(result.workspaceId).toBe("workspace_demo");
    expect(result.hostToken).toMatch(/^host_/);
    expect(await service.verifyHostToken(result.machineId, result.hostToken)).toBe(true);
  });

  it("rejects an invalid pairing code", async () => {
    const service = createHostService(createHostDb());

    await expect(
      service.pairHost({
        pairingCode: "NOPE",
        machineName: "Reece MacBook Pro",
        daemonVersion: "0.1.0"
      })
    ).rejects.toThrow("Invalid pairing code");
  });

  it("uses a configured pairing code when one is provided", async () => {
    const service = createHostService(createHostDb(), { pairingCode: "ABITAT-CLOUD" });

    await expect(
      service.pairHost({
        pairingCode: DEMO_PAIRING_CODE,
        machineName: "Reece MacBook Pro",
        daemonVersion: "0.1.0"
      })
    ).rejects.toThrow("Invalid pairing code");

    await expect(
      service.pairHost({
        pairingCode: "ABITAT-CLOUD",
        machineName: "Reece MacBook Pro",
        daemonVersion: "0.1.0"
      })
    ).resolves.toMatchObject({ machineId: "machine_demo" });
  });

  it("reads the pairing code from the environment with a demo fallback", () => {
    expect(getHostPairingCode({ ABITAT_PAIRING_CODE: "ABITAT-123ABC" })).toBe("ABITAT-123ABC");
    expect(getHostPairingCode({})).toBe(DEMO_PAIRING_CODE);
  });

  it("records heartbeat status and tool scans", async () => {
    const db = createHostDb();
    const service = createHostService(db);
    const paired = await service.pairHost({
      pairingCode: DEMO_PAIRING_CODE,
      machineName: "Reece MacBook Pro",
      daemonVersion: "0.1.0"
    });

    await service.recordHeartbeat(
      {
        machineId: paired.machineId,
        status: "online"
      },
      paired.hostToken
    );
    await service.recordToolScan(
      {
        machineId: paired.machineId,
        tools: [
          { name: "git", installed: true, version: "2.45.0", path: "/usr/bin/git" },
          { name: "codex", installed: false }
        ]
      },
      paired.hostToken
    );

    const machine = await db.machine.findUnique({ where: { id: paired.machineId } });
    if (!machine) {
      throw new Error("Missing paired machine");
    }

    expect(machine.status).toBe("online");
    expect(machine.installedToolsJson).toHaveLength(2);
  });

  it("can authenticate a paired host token without trusting arbitrary bearer strings", async () => {
    const service = createHostService(createHostDb());
    const paired = await service.pairHost({
      pairingCode: DEMO_PAIRING_CODE,
      machineName: "Reece MacBook Pro",
      daemonVersion: "0.1.0"
    });

    await expect(service.verifyAnyHostToken(paired.hostToken)).resolves.toBe(true);
    await expect(service.verifyAnyHostToken("host_not-real")).resolves.toBe(false);
  });
});
