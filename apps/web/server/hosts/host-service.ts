import { createHash, randomBytes } from "node:crypto";

import type {
  HostHeartbeatRequest,
  HostPairingRequest,
  ToolScanUploadRequest
} from "@abitat_reece/shared";

export const DEMO_PAIRING_CODE = "ABITAT-123456";

interface MachineRecord {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  status: string;
  pairingTokenHash: string | null;
  ownerUserId?: string | null;
  platform?: string | null;
  deviceKind?: string | null;
  capabilitiesJson?: unknown;
  installedToolsJson?: unknown;
  lastSeenAt?: Date | null;
}

interface MachineUpdateData {
  name?: string;
  status?: string;
  pairingTokenHash?: string;
  installedToolsJson?: unknown;
  lastSeenAt?: Date;
}

export interface HostDb {
  machine: {
    create(args: { data: MachineRecord }): Promise<MachineRecord>;
    findFirst(args?: unknown): Promise<MachineRecord | null>;
    findUnique(args: { where: { id: string } }): Promise<MachineRecord | null>;
    update(args: { where: { id: string }; data: MachineUpdateData }): Promise<MachineRecord>;
  };
}

export function hashHostToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getHostPairingCode(env: Partial<Record<string, string | undefined>> = process.env) {
  return env.ABITAT_PAIRING_CODE?.trim() || DEMO_PAIRING_CODE;
}

interface RegisterHostInput {
  userId: string;
  workspaceId: string;
  machineName: string;
  platform?: string;
}

interface HostServiceOptions {
  idGenerator?: (prefix: string) => string;
  pairingCode?: string;
  tokenGenerator?: () => string;
}

export function createHostService(db: HostDb, options: HostServiceOptions = {}) {
  const pairingCode = options.pairingCode ?? getHostPairingCode();
  const idGenerator =
    options.idGenerator ?? ((prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`);
  const tokenGenerator =
    options.tokenGenerator ?? (() => `host_${randomBytes(24).toString("hex")}`);

  return {
    async registerHost(input: RegisterHostInput) {
      const hostToken = tokenGenerator();
      const existing = await db.machine.findFirst({
        where: {
          ownerUserId: input.userId,
          workspaceId: input.workspaceId,
          type: "host"
        }
      });

      const data = {
        name: input.machineName,
        status: "online",
        ownerUserId: input.userId,
        platform: input.platform ?? "darwin",
        deviceKind: "host",
        capabilitiesJson: ["codex", "claude", "screen_capture", "input_control"],
        pairingTokenHash: hashHostToken(hostToken),
        lastSeenAt: new Date()
      };

      const machine = existing
        ? await db.machine.update({
            where: { id: existing.id },
            data
          })
        : await db.machine.create({
            data: {
              id: idGenerator("machine"),
              workspaceId: input.workspaceId,
              type: "host",
              installedToolsJson: [],
              ...data
            }
          });

      return {
        machineId: machine.id,
        workspaceId: machine.workspaceId,
        hostToken
      };
    },

    async pairHost(input: HostPairingRequest) {
      if (input.pairingCode !== pairingCode) {
        throw new Error("Invalid pairing code");
      }

      const machine = await db.machine.findFirst({
        where: {
          workspaceId: "workspace_demo",
          type: "host"
        }
      });

      if (!machine) {
        throw new Error("No host machine is available for pairing");
      }

      const hostToken = tokenGenerator();
      await db.machine.update({
        where: { id: machine.id },
        data: {
          name: input.machineName,
          status: "online",
          lastSeenAt: new Date(),
          pairingTokenHash: hashHostToken(hostToken)
        }
      });

      return {
        machineId: machine.id,
        workspaceId: machine.workspaceId,
        hostToken
      };
    },

    async verifyHostToken(machineId: string, hostToken: string) {
      const machine = await db.machine.findUnique({ where: { id: machineId } });
      return machine?.pairingTokenHash === hashHostToken(hostToken);
    },

    async verifyAnyHostToken(hostToken: string) {
      if (!hostToken) {
        return false;
      }

      const machine = await db.machine.findFirst({
        where: {
          pairingTokenHash: hashHostToken(hostToken)
        }
      });

      return Boolean(machine);
    },

    async recordHeartbeat(input: HostHeartbeatRequest, hostToken: string) {
      if (!(await this.verifyHostToken(input.machineId, hostToken))) {
        throw new Error("Invalid host token");
      }

      await db.machine.update({
        where: { id: input.machineId },
        data: {
          status: input.status,
          lastSeenAt: new Date()
        }
      });

      return {
        ok: true,
        serverTime: new Date().toISOString()
      } as const;
    },

    async recordToolScan(input: ToolScanUploadRequest, hostToken: string) {
      if (!(await this.verifyHostToken(input.machineId, hostToken))) {
        throw new Error("Invalid host token");
      }

      await db.machine.update({
        where: { id: input.machineId },
        data: {
          installedToolsJson: input.tools,
          lastSeenAt: new Date()
        }
      });

      return { ok: true } as const;
    },

    async getDemoHost() {
      return db.machine.findFirst({
        where: {
          workspaceId: "workspace_demo",
          type: "host"
        }
      });
    }
  };
}
