import { setTimeout as delay } from "node:timers/promises";

import type { CliSession } from "./auth";

export interface IphoneStartupInput {
  apiUrl: string;
  codexServerUrl: string;
  hostToken: string;
  machineId: string;
}

export interface StartupProcess {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface RegisterHostInput {
  apiUrl: string;
  cliToken: string;
  fetchFn?: FetchFn;
  machineName: string;
  maxAttempts?: number;
  platform: string;
  retryDelayMs?: number;
}

interface PrepareIphoneCommandInput {
  codexServerUrl: string;
  fetchFn?: FetchFn;
  machineName: string;
  platform: string;
  session: CliSession;
}

interface HostRegistration {
  machineId: string;
  workspaceId: string;
  hostToken: string;
}

type FetchFn = (
  url: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const DEFAULT_HOST_REGISTER_ATTEMPTS = 4;
const DEFAULT_HOST_REGISTER_RETRY_DELAY_MS = 1000;

export function createIphoneStartupPlan(input: IphoneStartupInput): StartupProcess[] {
  return [
    {
      name: "codex-app-server",
      command: "codex",
      args: ["app-server", "--listen", input.codexServerUrl, "--analytics-default-enabled"]
    },
    {
      name: "host-daemon",
      command: "abitat-host",
      args: ["start"],
      env: {
        ABITAT_API_URL: input.apiUrl,
        ABITAT_HOST_TOKEN: input.hostToken,
        ABITAT_MACHINE_ID: input.machineId,
        CODEX_APP_SERVER_URL: input.codexServerUrl
      }
    }
  ];
}

export async function registerHost(input: RegisterHostInput): Promise<HostRegistration> {
  const fetchFn = input.fetchFn ?? fetch;
  let lastError: unknown;
  const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_HOST_REGISTER_ATTEMPTS);
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_HOST_REGISTER_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchFn(`${trimTrailingSlash(input.apiUrl)}/api/hosts/register`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.cliToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          machineName: input.machineName,
          platform: input.platform
        })
      });

      if (response.ok) {
        return parseHostRegistration(await response.json());
      }

      const error = new Error(`Unable to register host (${response.status})`);
      if (!isTransientHostedStatus(response.status) || attempt >= maxAttempts) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (!isTransientFetchError(error) || attempt >= maxAttempts) {
        throw error;
      }
      lastError = error;
    }

    if (retryDelayMs > 0) {
      await delay(retryDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to register host");
}

function parseHostRegistration(value: unknown): HostRegistration {
  const body = value as Partial<HostRegistration>;
  if (
    typeof body.machineId !== "string" ||
    typeof body.workspaceId !== "string" ||
    typeof body.hostToken !== "string"
  ) {
    throw new Error("Host registration response was invalid");
  }

  return {
    machineId: body.machineId,
    workspaceId: body.workspaceId,
    hostToken: body.hostToken
  };
}

export async function prepareIphoneCommand(input: PrepareIphoneCommandInput) {
  const registration = await registerHost({
    apiUrl: input.session.apiUrl,
    cliToken: input.session.cliToken,
    fetchFn: input.fetchFn,
    machineName: input.machineName,
    platform: input.platform
  });

  return {
    registration,
    startupPlan: createIphoneStartupPlan({
      apiUrl: input.session.apiUrl,
      codexServerUrl: input.codexServerUrl,
      hostToken: registration.hostToken,
      machineId: registration.machineId
    })
  };
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, "");
}

function isTransientHostedStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isTransientFetchError(error: unknown) {
  return error instanceof TypeError;
}
