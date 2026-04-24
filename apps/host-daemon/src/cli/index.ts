#!/usr/bin/env node

import { runtimeSchema } from "@abitat/shared";

import { defaultConfigPath, loadHostConfig, saveHostConfig } from "../config/host-config.js";
import { HostApiClient } from "../transport/api-client.js";
import { createToolScanner } from "../tools/scanner.js";
import { parseStartOptions } from "./start-options.js";

const args = process.argv.slice(2);
const command = args[0] ?? "start";

void main();

async function main() {
  if (command === "pair") {
    await pairDaemon(args);
    return;
  }

  if (command === "start") {
    await startDaemon(args);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Usage: abitat-host pair --code ABITAT-123456 | abitat-host start --mock");
  process.exitCode = 1;
}

async function pairDaemon(args: string[]) {
  const pairingCode = readOption(args, "--code") ?? "";
  const apiUrl = process.env.ABITAT_API_URL ?? "http://localhost:3000";
  const machineName = process.env.ABITAT_MACHINE_NAME ?? "Abitat Host";
  const configPath = process.env.ABITAT_CONFIG_PATH ?? defaultConfigPath();
  const client = new HostApiClient(apiUrl);
  const response = await client.pair({
    pairingCode,
    machineName,
    daemonVersion: "0.1.0"
  });

  await saveHostConfig({ apiUrl, ...response }, configPath);
  console.log(`paired machineId=${response.machineId}`);
  console.log(`config=${configPath}`);
}

async function startDaemon(args: string[]) {
  const options = parseStartOptions(args);
  const runtime = runtimeSchema.parse(options.mock || args.length === 0 ? "mock" : "codex");
  const workspaceRoot = process.env.ABITAT_WORKSPACE_ROOT ?? "$HOME/AbitatWorkspace";
  const pollIntervalMs = Number(process.env.ABITAT_DAEMON_POLL_INTERVAL_MS ?? 2000);
  const configPath = process.env.ABITAT_CONFIG_PATH ?? defaultConfigPath();
  const config = await readConfigIfAvailable(configPath);
  const client = config ? new HostApiClient(config.apiUrl, config.hostToken) : null;

  console.log("Abitat Workspace host daemon");
  console.log(`mode=${runtime}`);
  console.log(`workspaceRoot=${workspaceRoot}`);
  console.log(`pollIntervalMs=${pollIntervalMs}`);
  console.log("status=online");

  if (client && config) {
    await uploadToolScan(client, config.machineId);
  }

  const beat = async () => {
    const timestamp = new Date().toISOString();
    console.log(`heartbeat=${timestamp}`);

    if (client && config) {
      await client.heartbeat({
        machineId: config.machineId,
        status: "online"
      });
      await pollDaemonJob(client, config.machineId);
    }
  };

  await beat();
  const heartbeat = setInterval(
    () => {
      void beat().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "heartbeat failed");
      });
    },
    Math.max(pollIntervalMs, 1000)
  );

  process.on("SIGINT", () => {
    clearInterval(heartbeat);
    void stopDaemon(client, config?.machineId);
  });
}

async function uploadToolScan(client: HostApiClient, machineId: string) {
  const tools = await createToolScanner().scan();
  await client.uploadTools(machineId, tools);
  console.log(`tools=${tools.filter((tool) => tool.installed).length}/${tools.length}`);
}

async function pollDaemonJob(client: HostApiClient, machineId: string) {
  const { job } = await client.pollJob(machineId);

  if (!job) {
    return;
  }

  console.log(`job=${job.id} type=${job.type}`);
  await client.ackJob(job.id, { status: "running" });
}

async function readConfigIfAvailable(path: string) {
  try {
    return await loadHostConfig(path);
  } catch {
    return null;
  }
}

function readOption(args: string[], option: string) {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

async function stopDaemon(client: HostApiClient | null, machineId?: string) {
  if (client && machineId) {
    await client
      .heartbeat({
        machineId,
        status: "offline"
      })
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "offline heartbeat failed");
      });
  }

  console.log("status=stopped");
  process.exit(0);
}
