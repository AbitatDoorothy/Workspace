#!/usr/bin/env node

import { runtimeSchema } from "@abitat/shared";

import { parseStartOptions } from "./start-options.js";

const args = process.argv.slice(2);
const command = args[0] ?? "start";

if (command !== "start") {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: abitat-host start --mock");
  process.exitCode = 1;
} else {
  startDaemon(args);
}

function startDaemon(args: string[]) {
  const options = parseStartOptions(args);
  const runtime = runtimeSchema.parse(options.mock ? "mock" : "codex");
  const workspaceRoot = process.env.ABITAT_WORKSPACE_ROOT ?? "$HOME/AbitatWorkspace";
  const pollIntervalMs = Number(process.env.ABITAT_DAEMON_POLL_INTERVAL_MS ?? 2000);

  console.log("Abitat Workspace host daemon");
  console.log(`mode=${runtime}`);
  console.log(`workspaceRoot=${workspaceRoot}`);
  console.log(`pollIntervalMs=${pollIntervalMs}`);
  console.log("status=online");

  const heartbeat = setInterval(
    () => {
      console.log(`heartbeat=${new Date().toISOString()}`);
    },
    Math.max(pollIntervalMs, 1000)
  );

  process.on("SIGINT", () => {
    clearInterval(heartbeat);
    console.log("status=stopped");
    process.exit(0);
  });
}
