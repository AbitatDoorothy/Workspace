#!/usr/bin/env node

import { homedir } from "node:os";
import { access } from "node:fs/promises";
import { runtimeSchema, type DaemonJob } from "@abitat/shared";

import { defaultConfigPath, loadHostConfig, saveHostConfig } from "../config/host-config.js";
import { collectChangeset } from "../git/changeset.js";
import { branchNameForConversation, resolveRepoPath } from "../git/paths.js";
import { commitAndPushWorktree, tryCreatePullRequest } from "../git/publish.js";
import { cleanupConversationWorktree, setupConversationWorktree } from "../git/worktree.js";
import { createRuntimeAdapter } from "../runtime/index.js";
import { HostApiClient } from "../transport/api-client.js";
import { createToolScanner } from "../tools/scanner.js";
import { runConversationRuntime } from "./conversation-runtime.js";
import { resolveDaemonConnection } from "./daemon-connection.js";
import { runHeartbeatWithRecovery } from "./heartbeat-loop.js";
import { createRetryableTask } from "./retryable-task.js";
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
  let connection = resolveDaemonConnection({ config, env: process.env });
  let client = new HostApiClient(connection.apiUrl, connection.hostToken);
  const activeState = createActiveDaemonState();

  console.log("Abitat Workspace host daemon");
  console.log(`mode=${runtime}`);
  console.log(`workspaceRoot=${workspaceRoot}`);
  console.log(`pollIntervalMs=${pollIntervalMs}`);
  console.log(`machineId=${connection.machineId}`);
  console.log(`paired=${connection.paired}`);
  console.log("status=online");

  // Auto-pair when starting unpaired (e.g. local dev via `pnpm dev`).
  if (!connection.paired) {
    const pairingCode = process.env.ABITAT_PAIRING_CODE;
    if (pairingCode) {
      try {
        const pairClient = new HostApiClient(connection.apiUrl);
        const result = await pairClient.pair({
          pairingCode,
          machineName: process.env.ABITAT_MACHINE_NAME ?? "Abitat Host",
          daemonVersion: "0.1.0"
        });
        await saveHostConfig({ apiUrl: connection.apiUrl, ...result }, configPath);
        connection = resolveDaemonConnection({
          config: await loadHostConfig(configPath),
          env: process.env
        });
        client = new HostApiClient(connection.apiUrl, connection.hostToken);
        console.log(`paired=${connection.paired}`);
        console.log(`machineId=${connection.machineId}`);
      } catch (error) {
        console.error("auto-pair failed:", error instanceof Error ? error.message : error);
      }
    }
  }

  const toolScanUpload = createRetryableTask(async () => {
    await uploadToolScan(client, connection.machineId);
  });

  const beat = async () => {
    const timestamp = new Date().toISOString();
    console.log(`heartbeat=${timestamp}`);

    if (connection.paired) {
      await toolScanUpload.run();
    }

    if (connection.paired) {
      const activeConversationIds = getActiveConversationIds(activeState);
      await client.heartbeat({
        machineId: connection.machineId,
        status: "online",
        activeConversationId: activeConversationIds[0],
        activeConversationIds
      });
    }

    await pollDaemonJob(
      client,
      connection.machineId,
      workspaceRoot,
      activeState,
      connection.apiUrl,
      connection.hostToken
    );
  };

  await runHeartbeatWithRecovery(beat);
  const heartbeat = setInterval(
    () => {
      void runHeartbeatWithRecovery(beat);
    },
    Math.max(pollIntervalMs, 1000)
  );

  process.on("SIGINT", () => {
    clearInterval(heartbeat);
    void stopDaemon(client, connection);
  });
}

interface ActiveDaemonState {
  conversationIds: Set<string>;
  tasks: Set<Promise<void>>;
}

function createActiveDaemonState(): ActiveDaemonState {
  return {
    conversationIds: new Set<string>(),
    tasks: new Set<Promise<void>>()
  };
}

function getActiveConversationIds(activeState: ActiveDaemonState) {
  return Array.from(activeState.conversationIds);
}

function trackBackgroundTask(activeState: ActiveDaemonState, task: Promise<void>) {
  activeState.tasks.add(task);
  void task
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "background job failed");
    })
    .finally(() => {
      activeState.tasks.delete(task);
    });
}

async function uploadToolScan(client: HostApiClient, machineId: string) {
  const tools = await createToolScanner().scan();
  await client.uploadTools(machineId, tools);
  console.log(`tools=${tools.filter((tool) => tool.installed).length}/${tools.length}`);
}

async function pollDaemonJob(
  client: HostApiClient,
  machineId: string,
  workspaceRoot: string,
  activeState: ActiveDaemonState,
  apiUrl: string,
  hostToken?: string
) {
  const { job } = await client.pollJob(machineId, getActiveConversationIds(activeState));

  if (!job) {
    return;
  }

  console.log(`job=${job.id} type=${job.type}`);

  if (job.type === "commit_and_push") {
    try {
      activeState.conversationIds.add(job.conversationId);
      await commitAndPushConversation(client, job);
    } finally {
      activeState.conversationIds.delete(job.conversationId);
    }
    return;
  }

  if (job.type === "summarize_conversation") {
    activeState.conversationIds.add(job.conversationId);
    const task = runSummarizeConversationJob(client, job, activeState, apiUrl, hostToken);
    trackBackgroundTask(activeState, task);
    return;
  }

  if (job.type !== "start_conversation") {
    await client.ackJob(job.id, { status: "running" });
    return;
  }

  activeState.conversationIds.add(job.conversationId);
  const task = runStartConversationJob(client, job, workspaceRoot, activeState, apiUrl, hostToken);
  trackBackgroundTask(activeState, task);
}

async function runStartConversationJob(
  client: HostApiClient,
  job: Extract<DaemonJob, { type: "start_conversation" }>,
  workspaceRoot: string,
  activeState: ActiveDaemonState,
  apiUrl: string,
  hostToken?: string
) {
  try {
    const setup =
      job.payload.resumeSessionId && job.payload.worktreePath && job.payload.branchName
        ? {
            branchName: job.payload.branchName,
            repoPath: job.payload.hostLocalPath
              ? undefined
              : resolveRepoPath(workspaceRoot, job.payload.repoUrl),
            worktreePath: job.payload.worktreePath
          }
        : job.payload.hostLocalPath
          ? await setupLocalConversationFolder(job)
          : await setupConversationWorktree({
              workspaceRoot,
              conversationId: job.conversationId,
              conversationType: job.payload.conversationType,
              prompt: job.payload.taskTitle ?? job.payload.prompt,
              repoUrl: job.payload.repoUrl,
              defaultBranch: "main"
            });

    console.log(`branch=${setup.branchName}`);
    console.log(`worktree=${setup.worktreePath}`);
    await client.ackJob(job.id, {
      status: "running",
      branchName: setup.branchName,
      worktreePath: setup.worktreePath
    });

    const runtimeSessionId = await runConversationRuntime(
      client,
      createRuntimeAdapter(job.payload.agentRuntime, {
        presentation: job.payload.presentation,
        pty: { apiUrl, hostToken }
      }),
      {
        conversationId: job.conversationId,
        worktreePath: setup.worktreePath,
        prompt: job.payload.prompt,
        model: job.payload.model,
        instructions: job.payload.instructions,
        allowedTools: job.payload.allowedTools,
        resumeSessionId: job.payload.resumeSessionId,
        skipGitRepoCheck: Boolean(job.payload.hostLocalPath)
      }
    );
    const changeSet = await collectChangeset(setup.worktreePath);
    await client.uploadChangeSet(job.conversationId, changeSet);
    await client.ackJob(job.id, {
      status: "completed",
      branchName: setup.branchName,
      worktreePath: setup.worktreePath,
      runtimeSessionId
    });
  } catch (error) {
    await client.ackJob(job.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "worktree setup failed"
    });
  } finally {
    activeState.conversationIds.delete(job.conversationId);
  }
}

async function runSummarizeConversationJob(
  client: HostApiClient,
  job: Extract<DaemonJob, { type: "summarize_conversation" }>,
  activeState: ActiveDaemonState,
  apiUrl: string,
  hostToken?: string
) {
  try {
    const worktreePath = job.payload.worktreePath ?? job.payload.hostLocalPath ?? "";
    if (!worktreePath || !job.payload.branchName || !job.payload.resumeSessionId) {
      throw new Error("Summary job is missing existing Codex thread metadata");
    }

    await access(worktreePath);
    await client.ackJob(job.id, {
      status: "running",
      branchName: job.payload.branchName,
      worktreePath
    });

    const runtimeSessionId = await runConversationRuntime(
      client,
      createRuntimeAdapter(job.payload.agentRuntime, {
        presentation: "inline",
        pty: { apiUrl, hostToken }
      }),
      {
        allowedTools: job.payload.allowedTools,
        captureSummary: true,
        conversationId: job.conversationId,
        instructions: job.payload.instructions,
        model: job.payload.model,
        prompt: job.payload.prompt,
        resumeSessionId: job.payload.resumeSessionId,
        skipGitRepoCheck: Boolean(job.payload.hostLocalPath),
        worktreePath
      }
    );

    await client.ackJob(job.id, {
      status: "completed",
      branchName: job.payload.branchName,
      runtimeSessionId,
      worktreePath
    });
  } catch (error) {
    await client.ackJob(job.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "summary job failed"
    });
  } finally {
    activeState.conversationIds.delete(job.conversationId);
  }
}

async function setupLocalConversationFolder(
  job: Extract<DaemonJob, { type: "start_conversation" }>
) {
  const worktreePath = job.payload.hostLocalPath ?? "";
  await access(worktreePath);

  return {
    branchName: branchNameForConversation({
      conversationId: job.conversationId,
      conversationType: job.payload.conversationType,
      prompt: job.payload.taskTitle ?? job.payload.prompt
    }),
    repoPath: undefined,
    worktreePath
  };
}

async function commitAndPushConversation(
  client: HostApiClient,
  job: Extract<DaemonJob, { type: "commit_and_push" }>
) {
  await client.ackJob(job.id, { status: "running" });

  try {
    const result = await commitAndPushWorktree({
      worktreePath: job.payload.worktreePath,
      branchName: job.payload.branchName,
      commitMessage: job.payload.commitMessage
    });
    const prResult = await tryCreatePullRequest({
      worktreePath: job.payload.worktreePath,
      branchName: job.payload.branchName
    });

    await client.ackJob(job.id, {
      status: "completed",
      commitSha: result.commitSha,
      prUrl: "prUrl" in prResult ? prResult.prUrl : undefined,
      errorMessage: "errorMessage" in prResult ? prResult.errorMessage : undefined
    });
  } catch (error) {
    await client.ackJob(job.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "commit and push failed"
    });
  }
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
