#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import {
  DEFAULT_IPHONE_LOGIN_PASSWORD,
  createIphoneLauncherBaseEnv,
  createLauncherEnv,
  createRemoteTunnelEnv,
  findAvailablePort,
  isTcpPortOpen,
  parseNextDevLock,
  parseWebSocketEndpoint,
  selectLanAddress,
  shouldStartRemoteTunnel
} from "./iphone-dev-utils.mjs";

const CODEX_BINARY =
  process.env.CODEX_APP_BINARY ?? "/Applications/Codex.app/Contents/Resources/codex";
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const children = new Set();

async function main() {
  const baseEnv = await loadEnvFile();
  const lanAddress = selectLanAddress(os.networkInterfaces());
  let env = createLauncherEnv({ baseEnv, lanAddress });
  await stopExistingNextDevServer();
  const requestedPort = Number(env.PORT);
  const availablePort = await findAvailablePort(requestedPort);

  if (availablePort !== requestedPort) {
    env = createLauncherEnv({
      baseEnv: { ...baseEnv, PORT: String(availablePort) },
      lanAddress
    });
  }

  const codexEndpoint = parseWebSocketEndpoint(env.CODEX_APP_SERVER_URL);
  await ensureCodexAppServer(env.CODEX_APP_SERVER_URL, codexEndpoint);
  const localWebOrigin = `http://127.0.0.1:${env.PORT}`;
  const useRemoteTunnel = shouldStartRemoteTunnel(env);

  const web = start("pnpm", ["--filter", "web", "dev"], {
    env
  });

  web.on("exit", (code) => {
    shutdown(code ?? 0);
  });

  if (useRemoteTunnel) {
    console.log(`Starting iPhone remote tunnel for ${env.ABITAT_PUBLIC_URL}...`);
    start(process.execPath, ["scripts/worker-tunnel-client.mjs"], {
      env: createRemoteTunnelEnv({ baseEnv: env, localOrigin: localWebOrigin }),
      label: "tunnel"
    });
    await waitForRemoteTunnel(env.ABITAT_PUBLIC_URL);
  }

  console.log("");
  console.log("Abitat iPhone dev launcher");
  console.log(`Mac web UI:     ${localWebOrigin}/`);
  console.log(`iPhone API URL: ${env.ABITAT_PUBLIC_URL}`);
  console.log(`Network mode:   ${useRemoteTunnel ? "remote tunnel" : "local network"}`);
  console.log(`Codex bridge:   ${env.CODEX_APP_SERVER_URL}`);
  console.log(`Login password: ${loginPasswordLabel(env)}`);
  console.log("");
  console.log("Use the iPhone API URL in the app pairing screen, then pair from the web UI.");
  if (!useRemoteTunnel) {
    console.log(
      "Hotel or guest Wi-Fi can block local-network pairing. Use the remote URL if needed."
    );
  }
  console.log("Press Ctrl+C here to stop the launcher.");
  console.log("");
}

async function loadEnvFile() {
  const envPath = new URL("../.env.local", import.meta.url);
  const raw = await readFile(envPath, "utf8").catch(() => null);

  return createIphoneLauncherBaseEnv({ envFile: raw ?? "", shellEnv: process.env });
}

function loginPasswordLabel(env) {
  if (env.ABITAT_LOGIN_PASSWORD === DEFAULT_IPHONE_LOGIN_PASSWORD) {
    return DEFAULT_IPHONE_LOGIN_PASSWORD;
  }

  return "custom from shell ABITAT_LOGIN_PASSWORD";
}

async function ensureCodexAppServer(serverUrl, endpoint) {
  if (await isTcpPortOpen(endpoint.host, endpoint.port)) {
    return;
  }

  console.log(`Starting Codex app-server at ${serverUrl}...`);
  start(CODEX_BINARY, ["app-server", "--listen", serverUrl, "--analytics-default-enabled"], {
    env: process.env,
    label: "codex"
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (await isTcpPortOpen(endpoint.host, endpoint.port)) {
      return;
    }

    await delay(250);
  }

  throw new Error("Codex app-server did not become reachable within 15 seconds.");
}

async function waitForRemoteTunnel(publicUrl) {
  const statusUrl = new URL("/__abitat_tunnel/status", publicUrl);
  const startedAt = Date.now();
  console.log(`Waiting for remote iPhone tunnel at ${statusUrl.origin}...`);

  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(statusUrl);
      if (response.ok) {
        const status = await response.json();
        if (status.connected) {
          return;
        }
      }
    } catch {
      // The Worker may take a moment to accept the outbound connector.
    }

    await delay(500);
  }

  throw new Error("iPhone remote tunnel did not become reachable within 20 seconds.");
}

async function stopExistingNextDevServer() {
  const lockPath = new URL("../apps/web/.next/dev/lock", import.meta.url);
  const lock = await readFile(lockPath, "utf8")
    .then(parseNextDevLock)
    .catch(() => null);

  if (!lock || !isProcessRunning(lock.pid)) {
    return;
  }

  console.log(`Stopping existing web dev server on ${lock.appUrl} (PID ${lock.pid})...`);
  process.kill(lock.pid, "SIGTERM");

  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    if (!isProcessRunning(lock.pid) && !(await isTcpPortOpen("127.0.0.1", lock.port))) {
      return;
    }

    await delay(200);
  }

  if (isProcessRunning(lock.pid)) {
    process.kill(lock.pid, "SIGKILL");
  }
}

function start(command, args, { env, label } = {}) {
  const child = spawn(command, args, {
    cwd: ROOT_DIR,
    env: { ...process.env, ...env },
    stdio: label ? ["ignore", "pipe", "pipe"] : "inherit"
  });

  children.add(child);
  child.on("exit", () => {
    children.delete(child);
  });

  if (label) {
    child.stdout?.on("data", (chunk) => relay(label, chunk));
    child.stderr?.on("data", (chunk) => relay(label, chunk));
  }

  child.on("error", (error) => {
    console.error(`Unable to start ${command}: ${error.message}`);
    shutdown(1);
  });

  return child;
}

function relay(label, chunk) {
  for (const line of String(chunk).split(/\r?\n/u)) {
    if (line.trim()) {
      console.log(`[${label}] ${line}`);
    }
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function shutdown(code = 0) {
  for (const child of children) {
    child.kill("SIGTERM");
  }

  process.exit(code);
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
