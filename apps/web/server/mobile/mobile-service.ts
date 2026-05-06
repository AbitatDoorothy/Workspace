import { createHash, randomBytes } from "node:crypto";

import type {
  MachineStatus,
  PhonePairingCompleteRequest,
  PhonePairingCompleteResponse,
  PhonePairingStartResponse
} from "@abitat/shared";

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
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
  tokenGenerator?: () => string;
}

const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;

export function hashMobileToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPairingCode(code: string) {
  return hashMobileToken(normalizePairingCode(code));
}

export function createMobileService(db: MobileDb, options: MobileServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const idGenerator =
    options.idGenerator ?? ((prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`);
  const tokenGenerator =
    options.tokenGenerator ?? (() => `client_${randomBytes(24).toString("hex")}`);
  const codeGenerator = options.codeGenerator ?? createPairingCode;

  return {
    async createPhonePairing(input: CreatePhonePairingInput): Promise<PhonePairingStartResponse> {
      const host = await db.machine.findUnique({ where: { id: input.hostMachineId } });
      if (!host || host.workspaceId !== input.workspaceId || host.type !== "host") {
        throw new Error("Host machine not found");
      }

      const createdAt = now();
      const code = codeGenerator();
      const pairing = await db.devicePairing.create({
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
      });

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
      const pairing = await db.devicePairing.findFirst({
        where: { codeHash: hashPairingCode(input.code) }
      });

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

      const host = await db.machine.findUnique({ where: { id: pairing.hostMachineId } });
      if (!host) {
        throw new Error("Host machine not found");
      }

      const clientToken = tokenGenerator();
      const phone = await db.machine.create({
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
      });

      await db.devicePairing.update({
        where: { id: pairing.id },
        data: {
          consumedAt: pairedAt,
          approvedAt: pairedAt
        }
      });

      return {
        machineId: phone.id,
        workspaceId: pairing.workspaceId,
        hostMachineId: pairing.hostMachineId,
        clientToken
      };
    },

    async verifyMobileToken(machineId: string, token: string) {
      const machine = await db.machine.findUnique({ where: { id: machineId } });
      return machine?.tokenHash === hashMobileToken(token);
    },

    async requireMobileActor(token: string): Promise<MobileActor> {
      const machine = await db.machine.findFirst({
        where: {
          type: "client",
          deviceKind: "phone",
          tokenHash: hashMobileToken(token)
        }
      });

      if (!machine) {
        throw new Error("Invalid mobile token");
      }

      await db.machine.update({
        where: { id: machine.id },
        data: {
          status: "online",
          lastSeenAt: now()
        }
      });

      return {
        machineId: machine.id,
        workspaceId: machine.workspaceId,
        hostMachineId: machine.pairedHostMachineId ?? null,
        userId: machine.ownerUserId ?? null
      };
    },

    async bootstrap(actor: MobileActor) {
      const [workspace, phone, host] = await Promise.all([
        db.workspace.findUnique({ where: { id: actor.workspaceId } }),
        db.machine.findUnique({ where: { id: actor.machineId } }),
        actor.hostMachineId ? db.machine.findUnique({ where: { id: actor.hostMachineId } }) : null
      ]);

      if (!workspace || !phone) {
        throw new Error("Mobile workspace not found");
      }

      return {
        workspace: {
          id: workspace.id,
          name: workspace.name
        },
        phone: mobileDeviceSummary(phone),
        host: host ? mobileDeviceSummary(host) : null
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

function mobileDeviceSummary(machine: MachineRecord) {
  return {
    id: machine.id,
    name: machine.name,
    status: normalizeStatus(machine.status)
  };
}

function normalizeStatus(status: string): MachineStatus {
  return status === "online" || status === "offline" || status === "error" ? status : "pending";
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
