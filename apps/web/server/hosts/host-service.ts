import type {
  HostHeartbeatRequest,
  HostPairingRequest,
  ToolScanUploadRequest
} from "@abitat_reece/shared";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";

import { randomHex, randomId, sha256Hex } from "../crypto";
import { retryDbOperation, runDbOperation } from "../db/operation";
import { getSessionSecret } from "../auth/session";

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
  return sha256Hex(token);
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
  dbOperationRetries?: number;
  dbOperationTimeoutMs?: number;
  idGenerator?: (prefix: string) => string;
  pairingCode?: string;
  tokenSecret?: string;
  tokenGenerator?: () => string;
}

const SIGNED_HOST_TOKEN_PREFIX = "host_v2_";

export function createHostService(db: HostDb, options: HostServiceOptions = {}) {
  const pairingCode = options.pairingCode ?? getHostPairingCode();
  const idGenerator = options.idGenerator ?? ((prefix: string) => randomId(prefix));
  const tokenGenerator = options.tokenGenerator ?? (() => `host_${randomHex(24)}`);
  const tokenSecret = options.tokenSecret ?? getSessionSecret();
  const dbOperationRetries = options.dbOperationRetries ?? 2;
  const dbOperationTimeoutMs = options.dbOperationTimeoutMs ?? 5000;

  return {
    async registerHost(input: RegisterHostInput) {
      const existing = await retryDbOperation(
        "host_register_find_existing",
        () =>
          db.machine.findFirst({
            where: {
              ownerUserId: input.userId,
              workspaceId: input.workspaceId,
              type: "host"
            }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
      const machineId = existing?.id ?? idGenerator("machine");
      const hostToken = options.tokenGenerator
        ? tokenGenerator()
        : createSignedHostToken(
            {
              machineId,
              workspaceId: input.workspaceId
            },
            tokenSecret
          );

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
        ? await retryDbOperation(
            "host_register_update_existing",
            () =>
              db.machine.update({
                where: { id: existing.id },
                data
              }),
            {
              retries: dbOperationRetries,
              timeoutMs: dbOperationTimeoutMs
            }
          )
        : await runDbOperation(
            "host_register_create_host",
            () =>
              db.machine.create({
                data: {
                  id: machineId,
                  workspaceId: input.workspaceId,
                  type: "host",
                  installedToolsJson: [],
                  ...data
                }
              }),
            dbOperationTimeoutMs
          );

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
      const signedHost = verifySignedHostToken(hostToken, tokenSecret);
      if (signedHost) {
        return signedHost.machineId === machineId;
      }

      const machine = await retryDbOperation(
        "host_verify_token_find_machine",
        () => db.machine.findUnique({ where: { id: machineId } }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
      return machine?.pairingTokenHash === hashHostToken(hostToken);
    },

    async verifyAnyHostToken(hostToken: string) {
      if (!hostToken) {
        return false;
      }
      if (verifySignedHostToken(hostToken, tokenSecret)) {
        return true;
      }

      const machine = await retryDbOperation(
        "host_verify_any_token_find_machine",
        () =>
          db.machine.findFirst({
            where: {
              pairingTokenHash: hashHostToken(hostToken)
            }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );

      return Boolean(machine);
    },

    async recordHeartbeat(input: HostHeartbeatRequest, hostToken: string) {
      const signedHost = verifySignedHostToken(hostToken, tokenSecret);
      if (
        signedHost
          ? signedHost.machineId !== input.machineId
          : !(await this.verifyHostToken(input.machineId, hostToken))
      ) {
        throw new Error("Invalid host token");
      }

      const updateHeartbeat = retryDbOperation(
        "host_heartbeat_update_machine",
        () =>
          db.machine.update({
            where: { id: input.machineId },
            data: {
              status: input.status,
              lastSeenAt: new Date()
            }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
      if (signedHost) {
        await updateHeartbeat.catch((error: unknown) => {
          console.warn("signed host heartbeat update skipped", {
            message: error instanceof Error ? error.message : String(error)
          });
        });
      } else {
        await updateHeartbeat;
      }

      return {
        ok: true,
        serverTime: new Date().toISOString()
      } as const;
    },

    async recordToolScan(input: ToolScanUploadRequest, hostToken: string) {
      if (!(await this.verifyHostToken(input.machineId, hostToken))) {
        throw new Error("Invalid host token");
      }

      await retryDbOperation(
        "host_tool_scan_update_machine",
        () =>
          db.machine.update({
            where: { id: input.machineId },
            data: {
              installedToolsJson: input.tools,
              lastSeenAt: new Date()
            }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );

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

function createSignedHostToken(
  payload: {
    machineId: string;
    workspaceId: string;
  },
  secret: string
) {
  const encoded = base64UrlString(JSON.stringify(payload));
  const signature = signHostTokenPayload(encoded, secret);
  return `${SIGNED_HOST_TOKEN_PREFIX}${encoded}.${signature}`;
}

function verifySignedHostToken(token: string, secret: string) {
  if (!token.startsWith(SIGNED_HOST_TOKEN_PREFIX)) {
    return null;
  }

  const rest = token.slice(SIGNED_HOST_TOKEN_PREFIX.length);
  const parts = rest.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payload, signature] = parts;
  if (signHostTokenPayload(payload, secret) !== signature) {
    return null;
  }

  try {
    const decoded = JSON.parse(base64UrlToString(payload)) as Partial<{
      machineId: unknown;
      workspaceId: unknown;
    }>;
    if (typeof decoded.machineId !== "string" || !decoded.machineId) {
      return null;
    }
    if (typeof decoded.workspaceId !== "string" || !decoded.workspaceId) {
      return null;
    }
    return {
      machineId: decoded.machineId,
      workspaceId: decoded.workspaceId
    };
  } catch {
    return null;
  }
}

function signHostTokenPayload(payload: string, secret: string) {
  const encoder = new TextEncoder();
  return base64UrlBytes(hmac(sha256, encoder.encode(secret), encoder.encode(payload)));
}

function base64UrlString(input: string) {
  return base64UrlBytes(new TextEncoder().encode(input));
}

function base64UrlBytes(input: Uint8Array) {
  const binary = Array.from(input, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToString(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
