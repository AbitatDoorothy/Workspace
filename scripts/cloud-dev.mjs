#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { Socket } from "node:net";
import { resolve } from "node:path";

loadEnvFile(".env.local");

const publicUrl = process.env.ABITAT_PUBLIC_URL ?? "https://workspace.abitat.io";
const tunnelMode = process.env.ABITAT_TUNNEL_MODE ?? "worker";
const tunnelToken = process.env.ABITAT_EDGE_TUNNEL_TOKEN ?? process.env.CLOUDFLARE_TUNNEL_TOKEN;

if (!tunnelToken) {
  console.error("Missing ABITAT_EDGE_TUNNEL_TOKEN or CLOUDFLARE_TUNNEL_TOKEN in .env.local");
  process.exit(1);
}

if (tunnelMode === "cloudflared" && !commandExists("cloudflared")) {
  console.error("Missing cloudflared. Install it with: brew install cloudflared");
  process.exit(1);
}

run("pnpm", ["db:migrate"]);
run("pnpm", ["db:seed"]);

const webIsRunning = await canConnect("127.0.0.1", 3000);

const children = [];
if (!webIsRunning) {
  children.push(
    start("pnpm", ["--filter", "web", "dev", "--hostname", "127.0.0.1", "--port", "3000"], {
      ABITAT_PUBLIC_URL: publicUrl,
      NEXTAUTH_URL: publicUrl
    })
  );
}

if (tunnelMode === "cloudflared") {
  children.push(start("node", ["scripts/cloudflare-edge-dns.mjs"]));
  children.push(
    start(
      "cloudflared",
      [
        "tunnel",
        "--protocol",
        "http2",
        "--region",
        "us",
        "run",
        "--dns-resolver-addrs",
        "127.0.0.1:55353"
      ],
      {
        TUNNEL_TOKEN: tunnelToken
      }
    )
  );
} else {
  children.push(
    start("node", ["scripts/worker-tunnel-client.mjs"], {
      ABITAT_PUBLIC_URL: publicUrl
    })
  );
}

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

function commandExists(command) {
  return spawnSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { env: process.env, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function start(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...extraEnv },
    stdio: "inherit"
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      stop(code);
    }
  });
  return child;
}

function canConnect(host, port) {
  return new Promise((resolveConnection) => {
    const socket = new Socket();
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolveConnection(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolveConnection(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolveConnection(false);
    });
    socket.connect(port, host);
  });
}

function stop(code = 0) {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(typeof code === "number" ? code : 0);
}
