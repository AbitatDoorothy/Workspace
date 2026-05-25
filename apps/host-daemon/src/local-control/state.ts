import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type LocalControlTransport = "local" | "tailscale" | "quick-tunnel" | "manual" | "relay";

export interface LocalPairingPayload {
  version: 1;
  product: "abitat";
  endpoint: string;
  macId: string;
  pairingSecret: string;
  manualCode: string;
  expiresAt: string;
  transport: LocalControlTransport;
  relayId?: string;
  capabilities: string[];
}

export interface LocalPairedDevice {
  id: string;
  name: string;
  platform: "ios" | string;
  pushSubscriptions?: LocalPushSubscription[];
  tokenHash: string;
  pairedAt: string;
  lastSeenAt: string;
  relayId?: string | null;
  revokedAt?: string | null;
}

export interface LocalPushSubscription {
  deviceId: string;
  id: string;
  lastSeenAt: string;
  platform: "ios" | string;
  provider: "expo" | string;
  registeredAt: string;
  token: string;
  revokedAt?: string | null;
}

interface LocalActivePairing {
  id: string;
  endpoint: string;
  secretHash: string;
  manualCodeHash: string;
  manualCode: string;
  expiresAt: string;
  consumedAt?: string | null;
  createdAt: string;
  relayId?: string | null;
  transport: LocalControlTransport;
}

interface LocalControlStateFile {
  version: 1;
  macId: string;
  macName: string;
  hostTokenHash: string;
  relayId?: string;
  pairedDevices: LocalPairedDevice[];
  activePairings: LocalActivePairing[];
}

interface CreateLocalControlStoreOptions {
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
  randomSecret?: () => string;
  statePath?: string;
}

interface CreatePairingInput {
  endpoint: string;
  relayId?: string;
  transport: LocalControlTransport;
  ttlMs?: number;
}

interface ConsumePairingInput {
  deviceName: string;
  pairingSecret?: string;
  manualCode?: string;
  code?: string;
  platform: "ios" | string;
}

interface RegisterPushSubscriptionInput {
  platform: "ios" | string;
  provider: "expo" | string;
  token: string;
}

const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;
const LOCAL_WORKSPACE_ID = "local";
const STATE_READ_RETRY_ATTEMPTS = 5;
const STATE_READ_RETRY_DELAY_MS = 10;
const PAIRING_CAPABILITIES = [
  "codex_chat",
  "codex_projects",
  "attachments",
  "screen_control"
] as const;

export function defaultLocalControlStatePath() {
  return join(homedir(), "Library", "Application Support", "Abitat", "local-control-state.json");
}

export function defaultLocalAttachmentDirectory() {
  return join(homedir(), "Library", "Application Support", "Abitat", "attachments");
}

export function hashLocalControlToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createLocalControlStore(options: CreateLocalControlStoreOptions = {}) {
  const statePath =
    options.statePath ??
    process.env.ABITAT_LOCAL_CONTROL_STATE_PATH ??
    defaultLocalControlStatePath();
  const now = options.now ?? (() => new Date());
  const randomSecret = options.randomSecret ?? (() => randomBytes(32).toString("base64url"));
  const idGenerator =
    options.idGenerator ?? ((prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`);
  let hostToken: string | null = null;
  let stateOperation = Promise.resolve();

  async function readOrCreateState() {
    const existing = await readStateFile(statePath);
    if (existing) {
      return existing;
    }

    hostToken = randomSecret();
    const created: LocalControlStateFile = {
      version: 1,
      macId: idGenerator("mac"),
      macName: hostname() || "Abitat Mac",
      hostTokenHash: hashLocalControlToken(hostToken),
      pairedDevices: [],
      activePairings: []
    };
    await saveState(created);
    return created;
  }

  function runStateOperation<T>(operation: () => Promise<T>) {
    const running = stateOperation.then(operation, operation);
    stateOperation = running.then(
      () => undefined,
      () => undefined
    );
    return running;
  }

  async function saveState(state: LocalControlStateFile) {
    await mkdir(dirname(statePath), { recursive: true });
    const tempPath = `${statePath}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, statePath);
  }

  return {
    statePath,

    async getMacIdentity() {
      return runStateOperation(async () => {
        const state = await readOrCreateState();
        return {
          macId: state.macId,
          macName: state.macName
        };
      });
    },

    async getHostToken() {
      return runStateOperation(async () => {
        const state = await readOrCreateState();
        if (hostToken && tokenMatchesHash(hostToken, state.hostTokenHash)) {
          return hostToken;
        }

        hostToken = randomSecret();
        await saveState({
          ...state,
          hostTokenHash: hashLocalControlToken(hostToken)
        });
        return hostToken;
      });
    },

    async getRelayId() {
      return runStateOperation(async () => {
        const state = await readOrCreateState();
        const existingRelayId = state.relayId ?? latestStoredRelayId(state);
        if (existingRelayId) {
          if (!state.relayId) {
            await saveState({
              ...state,
              relayId: existingRelayId
            });
          }
          return existingRelayId;
        }

        const relayId = idGenerator("relay");
        await saveState({
          ...state,
          relayId
        });
        return relayId;
      });
    },

    async createPairing(input: CreatePairingInput): Promise<LocalPairingPayload> {
      return runStateOperation(async () => {
        const state = await readOrCreateState();
        const createdAt = now();
        const pairingSecret = randomSecret();
        const manualCode = manualCodeFromSeed(randomSecret());
        const pairing: LocalActivePairing = {
          id: idGenerator("pairing"),
          endpoint: input.endpoint,
          secretHash: hashLocalControlToken(pairingSecret),
          manualCodeHash: hashLocalControlToken(normalizeManualCode(manualCode)),
          manualCode,
          expiresAt: new Date(
            createdAt.getTime() + (input.ttlMs ?? DEFAULT_PAIRING_TTL_MS)
          ).toISOString(),
          consumedAt: null,
          createdAt: createdAt.toISOString(),
          relayId: input.relayId ?? null,
          transport: input.transport
        };

        await saveState({
          ...state,
          activePairings: [
            ...state.activePairings.filter((candidate) => !isExpired(candidate, createdAt)),
            pairing
          ]
        });

        return {
          version: 1,
          product: "abitat",
          endpoint: input.endpoint,
          macId: state.macId,
          pairingSecret,
          manualCode,
          expiresAt: pairing.expiresAt,
          transport: input.transport,
          relayId: input.relayId,
          capabilities: [...PAIRING_CAPABILITIES]
        };
      });
    },

    async consumePairing(input: ConsumePairingInput) {
      return runStateOperation(async () => {
        const state = await readOrCreateState();
        const pairedAt = now();
        const manualCode = input.manualCode ?? input.code;
        const pairing = state.activePairings.find((candidate) => {
          if (input.pairingSecret && tokenMatchesHash(input.pairingSecret, candidate.secretHash)) {
            return true;
          }

          return Boolean(
            manualCode &&
              tokenMatchesHash(normalizeManualCode(manualCode), candidate.manualCodeHash)
          );
        });

        if (!pairing) {
          throw new Error("Invalid pairing code");
        }

        if (pairing.consumedAt) {
          throw new Error("Pairing code has already been used");
        }

        if (isExpired(pairing, pairedAt)) {
          throw new Error("Pairing code has expired");
        }

        const clientToken = randomSecret();
        const device: LocalPairedDevice = {
          id: idGenerator("phone"),
          name: input.deviceName,
          platform: input.platform,
          pushSubscriptions: [],
          tokenHash: hashLocalControlToken(clientToken),
          pairedAt: pairedAt.toISOString(),
          lastSeenAt: pairedAt.toISOString(),
          relayId: pairing.relayId ?? null,
          revokedAt: null
        };
        const nextPairings = state.activePairings.map((candidate) =>
          candidate.id === pairing.id
            ? { ...candidate, consumedAt: pairedAt.toISOString() }
            : candidate
        );

        await saveState({
          ...state,
          activePairings: nextPairings,
          pairedDevices: [...state.pairedDevices, device]
        });

        return {
          machineId: device.id,
          workspaceId: LOCAL_WORKSPACE_ID,
          hostMachineId: state.macId,
          clientToken,
          endpoint: pairing.endpoint,
          macId: state.macId
        };
      });
    },

    async getRelayKeyMaterials(relayId: string) {
      return runStateOperation(async () => {
        const state = await readOrCreateState();
        const checkedAt = now();
        const pairingMaterials = state.activePairings
          .filter(
            (pairing) =>
              pairing.relayId === relayId && !pairing.consumedAt && !isExpired(pairing, checkedAt)
          )
          .map((pairing) => ({
            id: pairing.id,
            kind: "pairing" as const,
            keyMaterial: pairing.secretHash
          }));
        const deviceMaterials = state.pairedDevices
          .filter((device) => device.relayId === relayId && !device.revokedAt)
          .map((device) => ({
            id: device.id,
            kind: "device" as const,
            keyMaterial: device.tokenHash
          }));

        return [...pairingMaterials, ...deviceMaterials];
      });
    },

    async listPushSubscriptions() {
      return runStateOperation(async () => {
        const state = await readOrCreateState();
        return state.pairedDevices
          .filter((device) => !device.revokedAt)
          .flatMap((device) =>
            (device.pushSubscriptions ?? [])
              .filter((subscription) => !subscription.revokedAt)
              .map((subscription) => ({
                ...subscription,
                deviceId: device.id
              }))
          );
      });
    },

    async registerPushSubscription(
      deviceId: string,
      input: RegisterPushSubscriptionInput
    ): Promise<LocalPushSubscription> {
      return runStateOperation(async () => {
        const state = await readOrCreateState();
        const device = state.pairedDevices.find(
          (candidate) => candidate.id === deviceId && !candidate.revokedAt
        );
        const token = input.token.trim();
        const provider = input.provider.trim() || "expo";
        const platform = input.platform.trim() || "ios";

        if (!device) {
          throw new Error("Paired device not found");
        }
        if (provider !== "expo" || !isExpoPushToken(token)) {
          throw new Error("Invalid Expo push token");
        }

        const seenAt = now().toISOString();
        const subscriptions = device.pushSubscriptions ?? [];
        const existing = subscriptions.find(
          (subscription) =>
            !subscription.revokedAt &&
            subscription.provider === provider &&
            subscription.platform === platform &&
            subscription.token === token
        );
        const subscription: LocalPushSubscription = existing
          ? {
              ...existing,
              deviceId: device.id,
              lastSeenAt: seenAt
            }
          : {
              deviceId: device.id,
              id: `${idGenerator("push")}_${hashLocalControlToken(token).slice(0, 8)}`,
              lastSeenAt: seenAt,
              platform,
              provider,
              registeredAt: seenAt,
              token,
              revokedAt: null
            };

        await saveState({
          ...state,
          pairedDevices: state.pairedDevices.map((candidate) =>
            candidate.id === device.id
              ? {
                  ...candidate,
                  pushSubscriptions: [
                    ...subscriptions.filter(
                      (candidateSubscription) => candidateSubscription.id !== subscription.id
                    ),
                    subscription
                  ]
                }
              : candidate
          )
        });

        return subscription;
      });
    },

    async requireDeviceByToken(token: string) {
      return runStateOperation(async () => {
        const state = await readOrCreateState();
        const device = state.pairedDevices.find(
          (candidate) => !candidate.revokedAt && tokenMatchesHash(token, candidate.tokenHash)
        );

        if (!device) {
          throw new Error("Invalid mobile token");
        }

        const seenAt = now().toISOString();
        await saveState({
          ...state,
          pairedDevices: state.pairedDevices.map((candidate) =>
            candidate.id === device.id ? { ...candidate, lastSeenAt: seenAt } : candidate
          )
        });

        return { ...device, lastSeenAt: seenAt };
      });
    }
  };
}

async function readStateFile(path: string): Promise<LocalControlStateFile | null> {
  for (let attempt = 0; attempt <= STATE_READ_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const raw = await readFile(path, "utf8");
      if (!raw.trim()) {
        throw new SyntaxError("State file is empty");
      }

      const parsed = JSON.parse(raw) as Partial<LocalControlStateFile>;
      if (parsed.version !== 1 || typeof parsed.macId !== "string") {
        return null;
      }

      return {
        version: 1,
        macId: parsed.macId,
        macName: typeof parsed.macName === "string" ? parsed.macName : hostname() || "Abitat Mac",
        hostTokenHash: typeof parsed.hostTokenHash === "string" ? parsed.hostTokenHash : "",
        relayId: typeof parsed.relayId === "string" ? parsed.relayId : undefined,
        pairedDevices: Array.isArray(parsed.pairedDevices) ? parsed.pairedDevices : [],
        activePairings: Array.isArray(parsed.activePairings) ? parsed.activePairings : []
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      if (isTransientStateReadError(error) && attempt < STATE_READ_RETRY_ATTEMPTS) {
        await delay(STATE_READ_RETRY_DELAY_MS);
        continue;
      }

      throw error;
    }
  }

  return null;
}

function isExpoPushToken(token: string) {
  return /^(Expo|Exponent)PushToken\[[^\]]+\]$/u.test(token);
}

function manualCodeFromSeed(seed: string) {
  const digest = hashLocalControlToken(seed).slice(0, 8).toUpperCase();
  return `ABITAT-${digest.slice(0, 4)}-${digest.slice(4, 8)}`;
}

function normalizeManualCode(code: string) {
  return code
    .trim()
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/\s+/gu, "")
    .toUpperCase();
}

function isExpired(pairing: Pick<LocalActivePairing, "expiresAt">, now: Date) {
  return Date.parse(pairing.expiresAt) <= now.getTime();
}

function latestStoredRelayId(state: LocalControlStateFile) {
  return [
    ...state.pairedDevices.flatMap((device) =>
      device.relayId ? [{ relayId: device.relayId, timestamp: Date.parse(device.pairedAt) }] : []
    ),
    ...state.activePairings.flatMap((pairing) =>
      pairing.relayId
        ? [{ relayId: pairing.relayId, timestamp: Date.parse(pairing.createdAt) }]
        : []
    )
  ]
    .sort((left, right) => right.timestamp - left.timestamp)
    .at(0)?.relayId;
}

function tokenMatchesHash(token: string, expectedHash: string) {
  const actual = Buffer.from(hashLocalControlToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isNotFoundError(error: unknown) {
  return Boolean(
    error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT"
  );
}

function isTransientStateReadError(error: unknown) {
  return error instanceof SyntaxError;
}

export type LocalControlStore = ReturnType<typeof createLocalControlStore>;
