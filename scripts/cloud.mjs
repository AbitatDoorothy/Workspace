#!/usr/bin/env node
import { spawn } from "node:child_process";

const children = new Set();
let hostTimer;
let stopping = false;
let exitCode = 0;

console.log("Starting Abitat cloud workspace: web, tunnel, and host daemon.");

start("cloud:dev", ["scripts/cloud-dev.mjs"]);
hostTimer = setTimeout(() => {
  start("cloud:host", ["scripts/cloud-host.mjs"]);
}, 750);

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

function start(label, args) {
  const child = spawn(process.execPath, args, {
    env: process.env,
    stdio: "inherit"
  });

  children.add(child);

  child.once("exit", (code, signal) => {
    children.delete(child);
    if (stopping) {
      maybeExit();
      return;
    }

    if (typeof code === "number" && code !== 0) {
      console.error(`${label} exited with code ${code}`);
      stop(code);
      return;
    }

    if (signal) {
      console.error(`${label} stopped by ${signal}`);
      stop(1);
      return;
    }

    stop(0);
  });

  child.once("error", (error) => {
    console.error(`${label} failed to start: ${error.message}`);
    stop(1);
  });

  return child;
}

function stop(code = 0) {
  if (stopping) {
    return;
  }

  stopping = true;
  exitCode = code;
  clearTimeout(hostTimer);

  for (const child of children) {
    child.kill("SIGTERM");
  }

  maybeExit();
}

function maybeExit() {
  if (!stopping || children.size > 0) {
    return;
  }

  process.exit(exitCode);
}
