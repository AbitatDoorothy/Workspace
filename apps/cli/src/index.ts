#!/usr/bin/env node

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultApiUrl,
  deleteCliSession,
  loadCliSession,
  runLoginCommand,
  sessionConfigPath,
  type FetchFn
} from "./auth.js";
import { createIphoneStartupPlan, type IphoneTransport, type StartupProcess } from "./iphone.js";

export type AbitatCommand = {
  command: "doctor" | "help" | "iphone" | "login" | "logout";
};

interface RunCliInput {
  env?: Partial<Record<string, string | undefined>>;
  fetchFn?: FetchFn;
  homeDir?: string;
  isEndpointListening?: (url: string) => Promise<boolean>;
  openUrl?: (url: string) => void;
  output?: (line: string) => void;
  platform?: string;
  pollIntervalMs?: number;
  startProcess?: (process: StartupProcess) => void;
}

interface ResolveStartupProcessOptions {
  nodePath?: string;
  resolvePackageExport?: (specifier: string) => string;
}

const DEFAULT_CODEX_APP_SERVER_URL = "ws://127.0.0.1:47777";
const HOST_DAEMON_CLI_EXPORT = "@abitat_reece/host-daemon/cli";

export function parseCommand(args: string[]): AbitatCommand {
  const command = args[0];
  if (command === "doctor" || command === "iphone" || command === "login" || command === "logout") {
    return { command };
  }

  return { command: "help" };
}

export async function runCli(args: string[], input: RunCliInput = {}) {
  const parsed = parseCommand(args);
  const env = input.env ?? process.env;
  const output = input.output ?? console.log;
  const openUrl = input.openUrl ?? openUrlInBrowser;
  const homeDir = input.homeDir ?? homedir();
  const configPath = env.ABITAT_CLI_CONFIG_PATH ?? sessionConfigPath(homeDir);
  const apiUrl = defaultApiUrl(env);

  if (parsed.command === "help") {
    output("Usage: abitat login | abitat iphone | abitat doctor | abitat logout");
    return 0;
  }

  if (parsed.command === "login") {
    const session = await runLoginCommand({
      apiUrl,
      configPath,
      fetchFn: input.fetchFn,
      openUrl,
      pollIntervalMs: input.pollIntervalMs
    });
    output(`Logged in to ${session.apiUrl}`);
    return 0;
  }

  if (parsed.command === "logout") {
    await deleteCliSession(configPath);
    output("Logged out");
    return 0;
  }

  if (parsed.command === "doctor") {
    const session = await loadCliSession(configPath);
    output("Local iPhone control does not require an Abitat hosted login.");
    if (session) {
      output(`Hosted web session: ${session.apiUrl}`);
    }
    return 0;
  }

  const startupPlan = createIphoneStartupPlan({
    codexServerUrl: env.CODEX_APP_SERVER_URL ?? DEFAULT_CODEX_APP_SERVER_URL,
    endpoint: readOption(args, "--endpoint") ?? env.ABITAT_LOCAL_CONTROL_ENDPOINT,
    port: numberOption(args, "--port", Number(env.ABITAT_LOCAL_CONTROL_PORT ?? 3901)),
    relayEndpoint: readOption(args, "--relay-endpoint") ?? env.ABITAT_RELAY_ENDPOINT,
    transport: transportOption(readOption(args, "--transport") ?? "relay")
  });

  output("Starting local-first iPhone control on this Mac.");
  output("The Mac will print a QR/manual pairing payload. No hosted domain or database is used.");
  for (const process of startupPlan) {
    (input.startProcess ?? startProcess)(process);
  }

  return 0;
}

function startProcess(process: StartupProcess) {
  const resolved = resolveStartupProcess(process);
  spawn(resolved.command, resolved.args, {
    env: { ...globalThis.process.env, ...resolved.env },
    stdio: "inherit"
  });
}

export function resolveStartupProcess(
  process: StartupProcess,
  options: ResolveStartupProcessOptions = {}
): StartupProcess {
  if (process.command !== "abitat-host") {
    return process;
  }

  try {
    const resolvePackageExport =
      options.resolvePackageExport ?? ((specifier: string) => import.meta.resolve(specifier));
    const daemonUrl = resolvePackageExport(HOST_DAEMON_CLI_EXPORT);

    return {
      ...process,
      command: options.nodePath ?? globalThis.process.execPath,
      args: [fileURLToPath(daemonUrl), ...process.args]
    };
  } catch {
    return process;
  }
}

function openUrlInBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function readOption(args: string[], option: string) {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(args: string[], option: string, fallback: number) {
  const value = readOption(args, option);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function transportOption(value: string): IphoneTransport {
  if (
    value === "auto" ||
    value === "local" ||
    value === "tailscale" ||
    value === "relay" ||
    value === "temporary-tunnel" ||
    value === "quick-tunnel" ||
    value === "manual"
  ) {
    return value;
  }

  return "auto";
}

export function isCliEntrypoint(importMetaUrl: string, argvPath = process.argv[1]) {
  if (!argvPath) {
    return false;
  }

  const modulePath = resolve(fileURLToPath(importMetaUrl));
  const invokedPath = resolve(argvPath);

  if (modulePath === invokedPath) {
    return true;
  }

  try {
    return realpathSync(modulePath) === realpathSync(invokedPath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
