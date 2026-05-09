import type {
  MachineStatus,
  PhonePairingCompleteRequest,
  PhonePairingCompleteResponse,
  PhonePairingStartResponse
} from "@abitat_reece/shared";

import { randomHex, randomId, sha256Hex } from "../crypto";
import { retryDbOperation, runDbOperation } from "../db/operation";

interface MachineRecord {
  id: string;
  workspaceId: string;
  name: string;
  type: "host" | "client" | string;
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

export interface MobilePushSubscription {
  machineId: string;
  platform: "ios";
  provider: "expo";
  token: string;
}

interface StoredMobilePushSubscription {
  platform: "ios";
  provider: "expo";
  registeredAt: string;
  token: string;
}

interface MachineCapabilities {
  features: string[];
  lastPushRegistrationDiagnostic?: StoredMobilePushRegistrationDiagnostic;
  pushSubscriptions: StoredMobilePushSubscription[];
}

interface StoredMobilePushRegistrationDiagnostic {
  message: string;
  reportedAt: string;
  stage: string;
}

interface DevicePairingRecord {
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

interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  hostLocalPath?: string | null;
  repoSyncStatus: string;
}

interface WorkspaceRecord {
  id: string;
  name: string;
}

export interface MobileDb {
  machine: {
    create(args: { data: MachineRecord }): Promise<MachineRecord>;
    findFirst(args: { where: Partial<MachineRecord> }): Promise<MachineRecord | null>;
    findMany(args: { where: Partial<MachineRecord> }): Promise<MachineRecord[]>;
    findUnique(args: { where: { id: string } }): Promise<MachineRecord | null>;
    update(args: { where: { id: string }; data: Partial<MachineRecord> }): Promise<MachineRecord>;
  };
  devicePairing: {
    create(args: { data: DevicePairingRecord }): Promise<DevicePairingRecord>;
    findFirst(args: { where: Partial<DevicePairingRecord> }): Promise<DevicePairingRecord | null>;
    update(args: {
      where: { id: string };
      data: Partial<DevicePairingRecord>;
    }): Promise<DevicePairingRecord>;
  };
  project: {
    findMany(args: { where: { workspaceId: string } }): Promise<ProjectRecord[]>;
  };
  workspace: {
    findUnique(args: { where: { id: string } }): Promise<WorkspaceRecord | null>;
  };
}

export interface MobileActor {
  machineId: string;
  workspaceId: string;
  hostMachineId: string | null;
  userId: string | null;
}

interface CreatePhonePairingInput {
  workspaceId: string;
  hostMachineId: string;
  createdByUserId: string;
  ttlMs?: number;
}

interface RegisterPushTokenInput {
  platform: "ios";
  provider: "expo";
  token: string;
}

interface RecordPushRegistrationDiagnosticInput {
  message: string;
  stage: string;
}

interface ListPushSubscriptionsInput {
  hostMachineId: string;
  workspaceId: string;
}

interface MobileServiceOptions {
  codeGenerator?: () => string;
  dbOperationRetries?: number;
  dbOperationTimeoutMs?: number;
  hostFreshnessMs?: number;
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
  tokenGenerator?: () => string;
}

const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;
const DEFAULT_HOST_FRESHNESS_MS = 30_000;

export function hashMobileToken(token: string) {
  return sha256Hex(token);
}

export function hashPairingCode(code: string) {
  return hashMobileToken(normalizePairingCode(code));
}

export function createMobileService(db: MobileDb, options: MobileServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const hostFreshnessMs = options.hostFreshnessMs ?? DEFAULT_HOST_FRESHNESS_MS;
  const idGenerator = options.idGenerator ?? ((prefix: string) => randomId(prefix));
  const tokenGenerator = options.tokenGenerator ?? (() => `client_${randomHex(24)}`);
  const codeGenerator = options.codeGenerator ?? createPairingCode;
  const dbOperationRetries = options.dbOperationRetries ?? 2;
  const dbOperationTimeoutMs = options.dbOperationTimeoutMs ?? 5000;

  return {
    async createPhonePairing(input: CreatePhonePairingInput): Promise<PhonePairingStartResponse> {
      const host = await retryDbOperation(
        "mobile_pairing_start_find_host",
        () => db.machine.findUnique({ where: { id: input.hostMachineId } }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
      if (!host || host.workspaceId !== input.workspaceId || host.type !== "host") {
        throw new Error("Host machine not found");
      }

      const createdAt = now();
      const code = codeGenerator();
      const pairing = await runDbOperation(
        "mobile_pairing_start_create_pairing",
        () =>
          db.devicePairing.create({
            data: {
              id: idGenerator("pairing"),
              workspaceId: input.workspaceId,
              hostMachineId: input.hostMachineId,
              createdByUserId: input.createdByUserId,
              codeHash: hashPairingCode(code),
              expiresAt: new Date(createdAt.getTime() + (input.ttlMs ?? DEFAULT_PAIRING_TTL_MS)),
              consumedAt: null,
              approvedAt: null,
              createdAt
            }
          }),
        dbOperationTimeoutMs
      );

      return {
        pairingId: pairing.id,
        code,
        expiresAt: pairing.expiresAt.toISOString(),
        qrPayload: `abitat://pair?code=${encodeURIComponent(code)}`
      };
    },

    async completePhonePairing(
      input: PhonePairingCompleteRequest
    ): Promise<PhonePairingCompleteResponse> {
      const pairing = await retryDbOperation(
        "mobile_pairing_complete_find_pairing",
        () =>
          db.devicePairing.findFirst({
            where: { codeHash: hashPairingCode(input.code) }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );

      if (!pairing) {
        throw new Error("Invalid pairing code");
      }

      if (pairing.consumedAt) {
        throw new Error("Pairing code has already been used");
      }

      const pairedAt = now();
      if (pairing.expiresAt.getTime() <= pairedAt.getTime()) {
        throw new Error("Pairing code has expired");
      }

      const host = await retryDbOperation(
        "mobile_pairing_complete_find_host",
        () => db.machine.findUnique({ where: { id: pairing.hostMachineId } }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
      if (!host) {
        throw new Error("Host machine not found");
      }

      const clientToken = tokenGenerator();
      const phone = await runDbOperation(
        "mobile_pairing_complete_create_phone",
        () =>
          db.machine.create({
            data: {
              id: idGenerator("machine"),
              workspaceId: pairing.workspaceId,
              name: input.deviceName,
              type: "client",
              status: "online",
              tokenHash: hashMobileToken(clientToken),
              ownerUserId: pairing.createdByUserId,
              platform: input.platform,
              deviceKind: "phone",
              publicKey: input.publicKey ?? null,
              pairedHostMachineId: pairing.hostMachineId,
              capabilitiesJson: {
                features: ["mobile_chat", "remote_control"],
                pushSubscriptions: []
              },
              lastSeenAt: pairedAt
            }
          }),
        dbOperationTimeoutMs
      );

      await runDbOperation(
        "mobile_pairing_complete_update_pairing",
        () =>
          db.devicePairing.update({
            where: { id: pairing.id },
            data: {
              consumedAt: pairedAt,
              approvedAt: pairedAt
            }
          }),
        dbOperationTimeoutMs
      );

      return {
        machineId: phone.id,
        workspaceId: pairing.workspaceId,
        hostMachineId: pairing.hostMachineId,
        clientToken
      };
    },

    async verifyMobileToken(machineId: string, token: string) {
      const machine = await retryDbOperation(
        "mobile_verify_token_find_machine",
        () => db.machine.findUnique({ where: { id: machineId } }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );
      return machine?.tokenHash === hashMobileToken(token);
    },

    async requireMobileActor(token: string): Promise<MobileActor> {
      const machine = await retryDbOperation(
        "mobile_require_actor_find_phone",
        () =>
          db.machine.findFirst({
            where: {
              type: "client",
              deviceKind: "phone",
              tokenHash: hashMobileToken(token)
            }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );

      if (!machine) {
        throw new Error("Invalid mobile token");
      }

      await retryDbOperation(
        "mobile_require_actor_update_phone",
        () =>
          db.machine.update({
            where: { id: machine.id },
            data: {
              status: "online",
              lastSeenAt: now()
            }
          }),
        {
          retries: dbOperationRetries,
          timeoutMs: dbOperationTimeoutMs
        }
      );

      return {
        machineId: machine.id,
        workspaceId: machine.workspaceId,
        hostMachineId: machine.pairedHostMachineId ?? null,
        userId: machine.ownerUserId ?? null
      };
    },

    async bootstrap(actor: MobileActor) {
      const hostMachineId = actor.hostMachineId;
      const [workspace, phone, host] = await Promise.all([
        retryDbOperation(
          "mobile_bootstrap_find_workspace",
          () => db.workspace.findUnique({ where: { id: actor.workspaceId } }),
          {
            retries: dbOperationRetries,
            timeoutMs: dbOperationTimeoutMs
          }
        ),
        retryDbOperation(
          "mobile_bootstrap_find_phone",
          () => db.machine.findUnique({ where: { id: actor.machineId } }),
          {
            retries: dbOperationRetries,
            timeoutMs: dbOperationTimeoutMs
          }
        ),
        hostMachineId
          ? retryDbOperation(
              "mobile_bootstrap_find_host",
              () => db.machine.findUnique({ where: { id: hostMachineId } }),
              {
                retries: dbOperationRetries,
                timeoutMs: dbOperationTimeoutMs
              }
            )
          : null
      ]);

      if (!workspace || !phone) {
        throw new Error("Mobile workspace not found");
      }

      return {
        workspace: {
          id: workspace.id,
          name: workspace.name
        },
        phone: mobileDeviceSummary(phone, { freshnessMs: hostFreshnessMs, now: now() }),
        host: host ? mobileDeviceSummary(host, { freshnessMs: hostFreshnessMs, now: now() }) : null
      };
    },

    listProjects(actor: MobileActor) {
      return db.project.findMany({ where: { workspaceId: actor.workspaceId } });
    },

    async registerPushToken(actor: MobileActor, input: RegisterPushTokenInput) {
      if (input.provider !== "expo" || !isExpoPushToken(input.token)) {
        throw new Error("Invalid Expo push token");
      }

      const phone = await db.machine.findUnique({ where: { id: actor.machineId } });
      if (!phone || phone.workspaceId !== actor.workspaceId || phone.type !== "client") {
        throw new Error("Mobile device not found");
      }

      const capabilities = normalizeMachineCapabilities(phone.capabilitiesJson);
      const registeredAt = now().toISOString();
      const nextSubscriptions = [
        ...capabilities.pushSubscriptions.filter(
          (subscription) =>
            subscription.provider !== input.provider || subscription.token !== input.token
        ),
        {
          platform: input.platform,
          provider: input.provider,
          registeredAt,
          token: input.token
        }
      ];

      await db.machine.update({
        where: { id: phone.id },
        data: {
          capabilitiesJson: {
            features: capabilities.features,
            pushSubscriptions: nextSubscriptions
          }
        }
      });

      return {
        platform: input.platform,
        provider: input.provider,
        token: input.token
      };
    },

    async recordPushRegistrationDiagnostic(
      actor: MobileActor,
      input: RecordPushRegistrationDiagnosticInput
    ) {
      const phone = await db.machine.findUnique({ where: { id: actor.machineId } });
      if (!phone || phone.workspaceId !== actor.workspaceId || phone.type !== "client") {
        throw new Error("Mobile device not found");
      }

      const capabilities = normalizeMachineCapabilities(phone.capabilitiesJson);
      const diagnostic = {
        message: input.message,
        reportedAt: now().toISOString(),
        stage: input.stage
      };

      await db.machine.update({
        where: { id: phone.id },
        data: {
          capabilitiesJson: {
            features: capabilities.features,
            lastPushRegistrationDiagnostic: diagnostic,
            pushSubscriptions: capabilities.pushSubscriptions
          }
        }
      });

      return diagnostic;
    },

    async listPushSubscriptionsForHost(
      input: ListPushSubscriptionsInput
    ): Promise<MobilePushSubscription[]> {
      const phones = await db.machine.findMany({
        where: {
          deviceKind: "phone",
          pairedHostMachineId: input.hostMachineId,
          type: "client",
          workspaceId: input.workspaceId
        }
      });

      return phones.flatMap((phone) =>
        normalizeMachineCapabilities(phone.capabilitiesJson).pushSubscriptions.map(
          (subscription) => ({
            machineId: phone.id,
            platform: subscription.platform,
            provider: subscription.provider,
            token: subscription.token
          })
        )
      );
    }
  };
}

function createPairingCode() {
  const digits = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `ABITAT-${digits}`;
}

function normalizePairingCode(code: string) {
  return code.trim().toUpperCase();
}

function mobileDeviceSummary(machine: MachineRecord, options?: { freshnessMs: number; now: Date }) {
  return {
    id: machine.id,
    name: machine.name,
    status: normalizeStatus(machine.status, machine.lastSeenAt, options)
  };
}

function normalizeStatus(
  status: string,
  lastSeenAt?: Date | null,
  options?: { freshnessMs: number; now: Date }
): MachineStatus {
  const normalized =
    status === "online" || status === "offline" || status === "error" ? status : "pending";

  if (!options || !lastSeenAt) {
    return normalized;
  }

  const ageMs = options.now.getTime() - lastSeenAt.getTime();
  const isFresh = ageMs >= 0 && ageMs <= options.freshnessMs;

  if (normalized === "pending" && isFresh) {
    return "online";
  }

  return normalized;
}

function normalizeMachineCapabilities(value: unknown): MachineCapabilities {
  if (Array.isArray(value)) {
    return {
      features: value.filter((feature): feature is string => typeof feature === "string"),
      pushSubscriptions: []
    };
  }

  if (!value || typeof value !== "object") {
    return { features: [], pushSubscriptions: [] };
  }

  const candidate = value as {
    features?: unknown;
    lastPushRegistrationDiagnostic?: unknown;
    pushSubscriptions?: unknown;
  };

  return {
    features: Array.isArray(candidate.features)
      ? candidate.features.filter((feature): feature is string => typeof feature === "string")
      : [],
    lastPushRegistrationDiagnostic: isStoredMobilePushRegistrationDiagnostic(
      candidate.lastPushRegistrationDiagnostic
    )
      ? candidate.lastPushRegistrationDiagnostic
      : undefined,
    pushSubscriptions: Array.isArray(candidate.pushSubscriptions)
      ? candidate.pushSubscriptions.filter(isStoredMobilePushSubscription)
      : []
  };
}

function isStoredMobilePushSubscription(value: unknown): value is StoredMobilePushSubscription {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredMobilePushSubscription>;
  return (
    candidate.platform === "ios" &&
    candidate.provider === "expo" &&
    typeof candidate.token === "string" &&
    isExpoPushToken(candidate.token) &&
    typeof candidate.registeredAt === "string"
  );
}

function isStoredMobilePushRegistrationDiagnostic(
  value: unknown
): value is StoredMobilePushRegistrationDiagnostic {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredMobilePushRegistrationDiagnostic>;
  return (
    typeof candidate.message === "string" &&
    typeof candidate.reportedAt === "string" &&
    typeof candidate.stage === "string"
  );
}

function isExpoPushToken(token: string) {
  return /^(Expo|Exponent)PushToken\[[^\]]+\]$/u.test(token);
}
