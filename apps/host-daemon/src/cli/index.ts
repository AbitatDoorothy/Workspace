#!/usr/bin/env node

import { homedir } from "node:os";
import { runtimeSchema } from "@abitat/shared";

import { defaultConfigPath, loadHostConfig, saveHostConfig } from "../config/host-config.js";
import { collectChangeset } from "../git/changeset.js";
import { resolveRepoPath } from "../git/paths.js";
import { cleanupConversationWorktree, setupConversationWorktree } from "../git/worktree.js";
import { createMockRuntimeAdapter } from "../runtime/mock.js";
import type { RuntimeEvent } from "../runtime/adapter.js";
import { HostApiClient } from "../transport/api-client.js";
import { createToolScanner } from "../tools/scanner.js";
import { resolveDaemonConnection } from "./daemon-connection.js";
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

  if (command === "cleanup-worktree") {
    await cleanupWorktree(args);
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
  const workspaceRoot = process.env.ABITAT_WORKSPACE_ROOT ?? `${homedir()}/AbitatWorkspace`;
  const pollIntervalMs = Number(process.env.ABITAT_DAEMON_POLL_INTERVAL_MS ?? 2000);
  const configPath = process.env.ABITAT_CONFIG_PATH ?? defaultConfigPath();
  const config = await readConfigIfAvailable(configPath);
  const connection = resolveDaemonConnection({ config, env: process.env });
  const client = new HostApiClient(connection.apiUrl, connection.hostToken);

  console.log("Abitat Workspace host daemon");
  console.log(`mode=${runtime}`);
  console.log(`workspaceRoot=${workspaceRoot}`);
  console.log(`pollIntervalMs=${pollIntervalMs}`);
  console.log(`machineId=${connection.machineId}`);
  console.log(`paired=${connection.paired}`);
  console.log("status=online");

  if (connection.paired) {
    await uploadToolScan(client, connection.machineId);
  }

  const beat = async () => {
    const timestamp = new Date().toISOString();
    console.log(`heartbeat=${timestamp}`);

    if (connection.paired) {
      await client.heartbeat({
        machineId: connection.machineId,
        status: "online"
      });
    }

    await pollDaemonJob(client, connection.machineId, workspaceRoot);
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
    void stopDaemon(client, connection);
  });
}

async function uploadToolScan(client: HostApiClient, machineId: string) {
  const tools = await createToolScanner().scan();
  await client.uploadTools(machineId, tools);
  console.log(`tools=${tools.filter((tool) => tool.installed).length}/${tools.length}`);
}

async function pollDaemonJob(client: HostApiClient, machineId: string, workspaceRoot: string) {
  const { job } = await client.pollJob(machineId);

  if (!job) {
    return;
  }

  console.log(`job=${job.id} type=${job.type}`);

  if (job.type !== "start_conversation") {
    await client.ackJob(job.id, { status: "running" });
    return;
  }

  try {
    const setup = await setupConversationWorktree({
      workspaceRoot,
      conversationId: job.conversationId,
      conversationType: job.payload.conversationType,
      prompt: job.payload.prompt,
      repoUrl: job.payload.repoUrl,
      defaultBranch: job.payload.defaultBranch
    });

    console.log(`branch=${setup.branchName}`);
    console.log(`worktree=${setup.worktreePath}`);
    await client.ackJob(job.id, {
      status: "running",
      branchName: setup.branchName,
      worktreePath: setup.worktreePath
    });

    if (job.payload.agentRuntime === "mock") {
      await runMockConversation(client, job.conversationId, {
        worktreePath: setup.worktreePath,
        prompt: job.payload.prompt,
        model: job.payload.model,
        instructions: job.payload.instructions
      });
      const changeSet = await collectChangeset(setup.worktreePath);
      await client.uploadChangeSet(job.conversationId, changeSet);
      await client.ackJob(job.id, {
        status: "completed",
        branchName: setup.branchName,
        worktreePath: setup.worktreePath
      });
    }
  } catch (error) {
    await client.ackJob(job.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "worktree setup failed"
    });
  }
}

async function runMockConversation(
  client: HostApiClient,
  conversationId: string,
  input: {
    worktreePath: string;
    prompt: string;
    model: string;
    instructions: string;
  }
) {
  let sequence = 1;

  await createMockRuntimeAdapter().run(input, async (event: RuntimeEvent) => {
    await client.ingestRunEvent(conversationId, {
      sequence,
      type: event.type,
      content: event.content,
      metadata: {}
    });
    sequence += 1;
  });
}

async function cleanupWorktree(args: string[]) {
  const workspaceRoot = process.env.ABITAT_WORKSPACE_ROOT ?? `${homedir()}/AbitatWorkspace`;
  const repoUrl = readOption(args, "--repo-url") ?? "";
  const worktreePath = readOption(args, "--path") ?? "";

  if (!repoUrl || !worktreePath) {
    throw new Error("Usage: abitat-host cleanup-worktree --repo-url <url> --path <worktree>");
  }

  await cleanupConversationWorktree({
    workspaceRoot,
    repoPath: resolveRepoPath(workspaceRoot, repoUrl),
    worktreePath
  });
  console.log(`cleanup=${worktreePath}`);
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

async function stopDaemon(
  client: HostApiClient,
  connection: { machineId: string; paired: boolean }
) {
  if (connection.paired) {
    await client
      .heartbeat({
        machineId: connection.machineId,
        status: "offline"
      })
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "offline heartbeat failed");
      });
  }

  console.log("status=stopped");
  process.exit(0);
}
