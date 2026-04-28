#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvFile(".env.local");

const publicUrl = process.env.ABITAT_PUBLIC_URL ?? "https://workspace.abitat.io";
const pairingCode = process.env.ABITAT_PAIRING_CODE ?? "ABITAT-123456";
const cliRuntimeMode = process.env.ABITAT_CLI_RUNTIME_MODE ?? "terminal";
const tunnelToken = process.env.ABITAT_EDGE_TUNNEL_TOKEN ?? process.env.CLOUDFLARE_TUNNEL_TOKEN;

// Use cloud API only when the tunnel is configured and the relay is reachable.
// Otherwise fall back to local dev (pnpm dev must be running in another terminal).
let apiUrl = process.env.ABITAT_API_URL ?? "http://localhost:3000";
if (tunnelToken) {
  apiUrl = publicUrl;
} else {
  console.warn(
    "No ABITAT_EDGE_TUNNEL_TOKEN set — using local API (%s). Run 'pnpm dev' first.",
    apiUrl
  );
}

if (apiUrl === publicUrl) {
  await waitForCloudConnector(apiUrl);
}

runWithRetry(
  "pnpm",
  ["--filter", "host-daemon", "exec", "tsx", "src/cli/index.ts", "pair", "--code", pairingCode],
  {
    ABITAT_API_URL: apiUrl
  },
  "pair host daemon"
);

const daemon = spawn(
  "pnpm",
  ["--filter", "host-daemon", "exec", "tsx", "src/cli/index.ts", "start"],
  {
    env: { ...process.env, ABITAT_API_URL: apiUrl, ABITAT_CLI_RUNTIME_MODE: cliRuntimeMode },
    stdio: "inherit"
  }
);

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function loadEnvFile(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    return;
  }

  for (const line of readFileSync(absolute, "utf8").split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    env: { ...process.env, ...extraEnv },
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function runWithRetry(command, args, extraEnv = {}, label = command) {
  const attempts = 5;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync(command, args, {
      env: { ...process.env, ...extraEnv },
      stdio: "inherit"
    });

    if (result.status === 0) {
      return;
    }

    if (attempt === attempts) {
      process.exit(result.status ?? 1);
    }

    console.error(`${label} failed; retrying in 2s (${attempt}/${attempts})`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
  }
}

async function waitForCloudConnector(apiUrl) {
  const statusUrl = new URL("/__abitat_tunnel/status", apiUrl);
  const attempts = 30;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(statusUrl);
      if (response.ok) {
        const status = await response.json();
        if (status.connected) {
          return;
        }
      }
    } catch {
      // VPN/proxy paths can reset TLS briefly; retry before failing the host command.
    }

    if (attempt === 1) {
      console.error("Waiting for the cloud connector to come online...");
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
  }

  console.error("Cloud connector is still offline. Run pnpm cloud from the project root.");
  process.exit(1);
}

function stop() {
  daemon.kill("SIGTERM");
  process.exit(0);
}
