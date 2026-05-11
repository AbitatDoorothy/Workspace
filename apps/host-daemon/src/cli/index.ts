#!/usr/bin/env node

import { homedir } from "node:os";
import { access } from "node:fs/promises";
import { runtimeSchema, type DaemonJob } from "@abitat_reece/shared";
import qrcode from "qrcode-terminal";

import { collectCodexAppSnapshot } from "../codex-app/snapshot.js";
import { defaultConfigPath, loadHostConfig, saveHostConfig } from "../config/host-config.js";
import { collectChangeset } from "../git/changeset.js";
import { branchNameForConversation, resolveRepoPath } from "../git/paths.js";
import { createLocalCodexBridge } from "../local-control/codex-bridge.js";
import {
  createMobileControlDiagnosticsLogger,
  logDiagnostics,
  mobileControlDiagnosticsLogPath
} from "../local-control/diagnostics-log.js";
import {
  createLocalCodexCompletionNotifier,
  createLocalMobilePushService
} from "../local-control/push-notifications.js";
import { startRelayClient } from "../local-control/relay-client.js";
import { startLocalControlServer } from "../local-control/server.js";
import { createLocalControlStore, type LocalControlTransport } from "../local-control/state.js";
import {
  resolveLocalControlTransport,
  shouldStartEndpointHealthMonitor,
  startEndpointHealthMonitor,
  startQuickTunnel,
  startTemporarySshTunnel,
  waitForQuickTunnelReady,
  type EndpointHealthMonitor,
  type QuickTunnel,
  type SshTunnel
} from "../local-control/transport.js";
import { commitAndPushWorktree, tryCreatePullRequest } from "../git/publish.js";
import { cleanupConversationWorktree, setupConversationWorktree } from "../git/worktree.js";
import { createRemoteControlManager } from "../remote-control/manager.js";
import { createRuntimeAdapter } from "../runtime/index.js";
import { HostApiClient, isTransientHostApiError } from "../transport/api-client.js";
import { createToolScanner } from "../tools/scanner.js";
import { runConversationRuntime } from "./conversation-runtime.js";
import { resolveDaemonConnection } from "./daemon-connection.js";
import { createSerialHeartbeatLoop, runHeartbeatWithRecovery } from "./heartbeat-loop.js";
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

  if (command === "iphone") {
    await startIphoneControl(args);
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
  console.error(
    "Usage: abitat-host iphone [--transport relay|temporary-tunnel|quick-tunnel|local|tailscale|manual] | abitat-host pair --code ABITAT-123456 | abitat-host start --mock"
  );
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

async function startIphoneControl(args: string[]) {
  const port = numberOption(args, "--port", Number(process.env.ABITAT_LOCAL_CONTROL_PORT ?? 3901));
  const requestedTransport = transportOption(readOption(args, "--transport") ?? "relay");
  const endpoint = readOption(args, "--endpoint") ?? process.env.ABITAT_LOCAL_CONTROL_ENDPOINT;
  const relayEndpoint =
    readOption(args, "--relay-endpoint") ??
    process.env.ABITAT_RELAY_ENDPOINT ??
    "https://workspace.abitat.io";
  const codexServerUrl =
    readOption(args, "--codex-server-url") ??
    process.env.CODEX_APP_SERVER_URL ??
    "ws://127.0.0.1:47777";
  const diagnosticsLogPath = mobileControlDiagnosticsLogPath();
  const diagnostics = createMobileControlDiagnosticsLogger({ logPath: diagnosticsLogPath });
  const transport = await resolveLocalControlTransport({
    endpoint,
    port,
    relayEndpoint,
    requestedTransport
  });
  const store = createLocalControlStore();
  const relayId = transport.transport === "relay" ? await store.getRelayId() : undefined;
  const codex = createLocalCodexBridge({ diagnostics, serverUrl: codexServerUrl });
  const server = await startLocalControlServer({
    bindHost: transport.bindHost,
    codex,
    diagnostics,
    endpoint: transport.endpoint,
    port,
    store,
    transport: transport.transport
  });
  let quickTunnel: QuickTunnel | null = null;
  let fallbackTunnel: SshTunnel | null = null;
  let endpointMonitor: EndpointHealthMonitor | null = null;
  let relayClient: { close(): void } | null = null;
  let stopCompletionNotifier: (() => void) | null = null;
  let publicEndpoint = server.endpoint;
  let pairingTransport = transport.transport;
  const stop = async (exitCode = 0) => {
    endpointMonitor?.stop();
    stopCompletionNotifier?.();
    relayClient?.close();
    await quickTunnel?.close().catch(() => undefined);
    await fallbackTunnel?.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    console.log("status=stopped");
    process.exit(exitCode);
  };
  stopCompletionNotifier = createLocalCodexCompletionNotifier({
    codex,
    diagnostics,
    logger: console,
    mobilePushService: createLocalMobilePushService(store, { diagnostics, logger: console })
  }).start();

  if (!endpoint && transport.transport === "relay") {
    if (!relayId || !transport.relayEndpoint) {
      throw new Error("Relay transport is missing relay configuration");
    }
    console.log(`Connecting this Mac to Abitat relay at ${transport.relayEndpoint}...`);
    relayClient = startRelayClient({
      diagnostics,
      localEndpoint: localServerEndpoint(port),
      relayEndpoint: transport.relayEndpoint,
      relayId,
      store
    });
    publicEndpoint = transport.relayEndpoint;
    pairingTransport = "relay";
  }

  if (!endpoint && requestedTransport === "temporary-tunnel") {
    console.log("Starting temporary HTTPS tunnel through localhost.run from this Mac...");
    fallbackTunnel = await startTemporarySshTunnel({
      localUrl: server.endpoint,
      onFallback(error) {
        console.log(
          `localhost.run is unavailable (${errorMessage(
            error
          )}). Trying Pinggy over SSH from this Mac...`
        );
      }
    }).catch(async (error) => {
      await server.close().catch(() => undefined);
      throw error;
    });
    publicEndpoint = fallbackTunnel.endpoint;
    pairingTransport = "manual";
    console.log("Waiting for temporary tunnel to become reachable...");
    await waitForQuickTunnelReady(publicEndpoint).catch(async (error) => {
      await fallbackTunnel?.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      throw error;
    });
  }

  if (!endpoint && transport.transport === "quick-tunnel") {
    console.log("Starting Cloudflare Quick Tunnel from this Mac...");
    try {
      quickTunnel = await startQuickTunnel({ localUrl: server.endpoint });
      publicEndpoint = quickTunnel.endpoint;
      console.log("Waiting for Cloudflare Quick Tunnel to become reachable...");
      await waitForQuickTunnelReady(publicEndpoint);
    } catch (error) {
      console.log(
        `Cloudflare Quick Tunnel is unavailable (${errorMessage(error)}). Falling back to localhost.run over SSH from this Mac...`
      );
      await quickTunnel?.close().catch(() => undefined);
      quickTunnel = null;
      fallbackTunnel = await startTemporarySshTunnel({
        localUrl: server.endpoint,
        onFallback(localhostRunError) {
          console.log(
            `localhost.run fallback is unavailable (${errorMessage(
              localhostRunError
            )}). Trying Pinggy over SSH from this Mac...`
          );
        }
      }).catch(async (fallbackError) => {
        await server.close().catch(() => undefined);
        throw fallbackError;
      });
      publicEndpoint = fallbackTunnel.endpoint;
      pairingTransport = "manual";
      console.log("Waiting for fallback tunnel to become reachable...");
      await waitForQuickTunnelReady(publicEndpoint).catch(async (fallbackError) => {
        await fallbackTunnel?.close().catch(() => undefined);
        await server.close().catch(() => undefined);
        throw fallbackError;
      });
    }
  }
  if (shouldStartEndpointHealthMonitor(pairingTransport)) {
    endpointMonitor = startEndpointHealthMonitor(publicEndpoint, {
      healthPath: "/health",
      intervalMs: 5_000,
      maxFailures: 2,
      onUnhealthy(error) {
        console.error(error.message);
        void stop(1);
      }
    });
  }
  const pairing = await store.createPairing({
    endpoint: publicEndpoint,
    relayId,
    transport: pairingTransport
  });
  logDiagnostics(diagnostics, "info", "pairing.created", {
    endpoint: publicEndpoint,
    expiresAt: pairing.expiresAt,
    macId: pairing.macId,
    relayId,
    transport: pairingTransport
  });
  const qrPayload = JSON.stringify(pairing);

  console.log("Abitat local iPhone control");
  console.log(`status=online`);
  console.log(`endpoint=${publicEndpoint}`);
  if (publicEndpoint !== server.endpoint) {
    console.log(`localEndpoint=${server.endpoint}`);
  }
  console.log(`transport=${pairingTransport}`);
  console.log(`diagnosticsLog=${diagnosticsLogPath}`);
  if (relayId) {
    console.log(`relayId=${relayId}`);
  }
  if (transport.warning) {
    console.log(`warning=${transport.warning}`);
  }
  console.log(`macId=${pairing.macId}`);
  console.log(`manualCode=${pairing.manualCode}`);
  console.log(`expiresAt=${pairing.expiresAt}`);
  console.log("");
  console.log("Scan this QR code in the Abitat iPhone app:");
  qrcode.generate(qrPayload, { small: true }, (qr) => console.log(qr));
  console.log("Manual pairing payload:");
  console.log(qrPayload);
  console.log("");
  console.log("Keep this command running while pairing and using the phone.");

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());

  await new Promise(() => undefined);
}

async function startDaemon(args: string[]) {
  const options = parseStartOptions(args);
  const runtime = runtimeSchema.parse(options.mock || args.length === 0 ? "mock" : "codex");
  const workspaceRoot = process.env.ABITAT_WORKSPACE_ROOT ?? `${homedir()}/AbitatWorkspace`;
  const pollIntervalMs = Number(process.env.ABITAT_DAEMON_POLL_INTERVAL_MS ?? 2000);
  const codexSnapshotIntervalMs = Number(process.env.ABITAT_CODEX_SNAPSHOT_INTERVAL_MS ?? 5000);
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
  const codexSnapshotUpload = createIntervalTask(codexSnapshotIntervalMs, async () => {
    await uploadCodexSnapshot(client, connection.machineId);
  });
  const remoteControlManager =
    process.env.ABITAT_ENABLE_REMOTE_CONTROL === "1"
      ? createRemoteControlManager(client, {
          apiUrl: connection.apiUrl,
          helperPath: process.env.ABITAT_REMOTE_CONTROL_HELPER_PATH,
          hostToken: connection.hostToken
        })
      : null;

  const beat = async () => {
    const timestamp = new Date().toISOString();
    console.log(`heartbeat=${timestamp}`);

    if (connection.paired) {
      await toolScanUpload.run();
      await codexSnapshotUpload.run();
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

    if (connection.paired && remoteControlManager) {
      await remoteControlManager.tick(connection.machineId);
    }
  };

  await runHeartbeatWithRecovery(beat);
  const heartbeat = createSerialHeartbeatLoop(beat, Math.max(pollIntervalMs, 1000));
  heartbeat.start();

  process.on("SIGINT", () => {
    heartbeat.stop();
    remoteControlManager?.stopAll();
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

async function uploadCodexSnapshot(client: HostApiClient, machineId: string) {
  const snapshot = await collectCodexAppSnapshot();
  await client.uploadCodexSnapshot(machineId, snapshot);
  console.log(
    `codexSnapshot=${snapshot.projects.length}/${snapshot.conversations.length}/${Object.keys(snapshot.messages).length}`
  );
}

function createIntervalTask(intervalMs: number, task: () => Promise<void>) {
  let lastStartedAt = 0;
  let inFlight: Promise<void> | null = null;

  return {
    async run() {
      if (inFlight) {
        return;
      }

      const now = Date.now();
      if (now - lastStartedAt < intervalMs) {
        return;
      }

      lastStartedAt = now;
      inFlight = task()
        .catch((error: unknown) => {
          console.error(
            `codex snapshot upload failed: ${error instanceof Error ? error.message : String(error)}`
          );
        })
        .finally(() => {
          inFlight = null;
        });
      await inFlight;
    }
  };
}

async function pollDaemonJob(
  client: HostApiClient,
  machineId: string,
  workspaceRoot: string,
  activeState: ActiveDaemonState,
  apiUrl: string,
  hostToken?: string
) {
  let response: Awaited<ReturnType<HostApiClient["pollJob"]>>;
  try {
    response = await client.pollJob(machineId, getActiveConversationIds(activeState));
  } catch (error) {
    if (isTransientHostApiError(error)) {
      console.error(`daemon job poll skipped: ${error.message}`);
      return;
    }
    throw error;
  }

  const { job } = response;

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

function numberOption(args: string[], option: string, fallback: number) {
  const value = readOption(args, option);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function transportOption(value: string) {
  const normalized = value.trim();
  if (
    normalized === "auto" ||
    normalized === "local" ||
    normalized === "tailscale" ||
    normalized === "temporary-tunnel" ||
    normalized === "relay" ||
    normalized === "quick-tunnel" ||
    normalized === "manual"
  ) {
    return normalized as "auto" | LocalControlTransport | "temporary-tunnel";
  }

  return "auto";
}

function localServerEndpoint(port: number) {
  return `http://127.0.0.1:${port}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
