import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface CliSession {
  apiUrl: string;
  cliToken: string;
  userId: string;
}

export interface RunLoginCommandInput {
  apiUrl: string;
  configPath: string;
  fetchFn?: FetchFn;
  maxPolls?: number;
  openUrl(url: string): void;
  pollIntervalMs?: number;
}

interface DeviceLoginStartResponse {
  code: string;
  deviceLoginId: string;
  expiresAt: string;
  verificationPath: string;
}

interface DeviceLoginApprovedResponse {
  status: "approved";
  cliToken: string;
  userId: string;
}

interface DeviceLoginPendingResponse {
  status: "pending";
}

type DeviceLoginPollResponse = DeviceLoginApprovedResponse | DeviceLoginPendingResponse;

export type FetchFn = (
  url: string,
  init?: {
    body?: string;
    headers?: Record<string, string>;
    method?: "POST";
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function defaultApiUrl(env: Partial<Record<string, string | undefined>>) {
  return env.ABITAT_API_URL ?? "https://workspace.abitat.io";
}

export function sessionConfigPath(homeDir: string) {
  return join(homeDir, "Library", "Application Support", "Abitat", "config.json");
}

export async function saveCliSession(session: CliSession, configPath: string) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export async function loadCliSession(configPath: string): Promise<CliSession | null> {
  const raw = await readFile(configPath, "utf8").catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  });

  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as Partial<CliSession>;
  if (
    typeof parsed.apiUrl !== "string" ||
    typeof parsed.cliToken !== "string" ||
    typeof parsed.userId !== "string"
  ) {
    return null;
  }

  return {
    apiUrl: parsed.apiUrl,
    cliToken: parsed.cliToken,
    userId: parsed.userId
  };
}

export async function deleteCliSession(configPath: string) {
  await rm(configPath, { force: true });
}

export async function runLoginCommand(input: RunLoginCommandInput): Promise<CliSession> {
  const fetchFn = input.fetchFn ?? fetch;
  const start = await startDeviceLogin(input.apiUrl, fetchFn);
  input.openUrl(new URL(start.verificationPath, input.apiUrl).toString());

  const maxPolls = input.maxPolls ?? 120;
  const pollIntervalMs = input.pollIntervalMs ?? 1000;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const poll = await pollDeviceLogin(input.apiUrl, start.deviceLoginId, fetchFn);
    if (poll.status === "approved") {
      const session = {
        apiUrl: input.apiUrl,
        cliToken: poll.cliToken,
        userId: poll.userId
      };
      await saveCliSession(session, input.configPath);
      return session;
    }

    if (pollIntervalMs > 0) {
      await delay(pollIntervalMs);
    }
  }

  throw new Error("Timed out waiting for browser login approval");
}

async function startDeviceLogin(apiUrl: string, fetchFn: FetchFn) {
  const response = await fetchFn(`${trimTrailingSlash(apiUrl)}/api/cli/device-login/start`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Unable to start CLI login (${response.status})`);
  }

  return parseStartResponse(await response.json());
}

async function pollDeviceLogin(apiUrl: string, deviceLoginId: string, fetchFn: FetchFn) {
  const response = await fetchFn(`${trimTrailingSlash(apiUrl)}/api/cli/device-login/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceLoginId })
  }).catch(() => null);

  if (!response) {
    return { status: "pending" as const };
  }

  if (!response.ok) {
    if (isTransientPollStatus(response.status)) {
      return { status: "pending" as const };
    }

    throw new Error(`Unable to poll CLI login (${response.status})`);
  }

  return parsePollResponse(await response.json());
}

function isTransientPollStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function parseStartResponse(value: unknown): DeviceLoginStartResponse {
  const candidate = value as Partial<DeviceLoginStartResponse>;
  if (
    typeof candidate.code !== "string" ||
    typeof candidate.deviceLoginId !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    typeof candidate.verificationPath !== "string"
  ) {
    throw new Error("CLI login start response was invalid");
  }

  return {
    code: candidate.code,
    deviceLoginId: candidate.deviceLoginId,
    expiresAt: candidate.expiresAt,
    verificationPath: candidate.verificationPath
  };
}

function parsePollResponse(value: unknown): DeviceLoginPollResponse {
  const candidate = value as Partial<DeviceLoginApprovedResponse | DeviceLoginPendingResponse>;
  if (candidate.status === "pending") {
    return { status: "pending" };
  }
  if (
    candidate.status === "approved" &&
    typeof candidate.cliToken === "string" &&
    typeof candidate.userId === "string"
  ) {
    return {
      status: "approved",
      cliToken: candidate.cliToken,
      userId: candidate.userId
    };
  }

  throw new Error("CLI login poll response was invalid");
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, "");
}

function isNotFoundError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
