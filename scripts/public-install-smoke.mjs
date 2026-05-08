#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packDir = await mkdtemp(join(tmpdir(), "abitat-pack-"));
const installDir = await mkdtemp(join(tmpdir(), "abitat-install-"));

try {
  await run("pnpm", ["--filter", "@abitat/shared", "build"], { cwd: root });
  await run("pnpm", ["--filter", "@abitat/host-daemon", "build"], { cwd: root });
  await run("pnpm", ["--filter", "@abitat/cli", "build"], { cwd: root });

  await pack("@abitat/shared");
  await pack("@abitat/host-daemon");
  await pack("@abitat/cli");

  await run("npm", ["init", "-y"], { cwd: installDir, quiet: true });
  await run(
    "npm",
    [
      "install",
      join(packDir, "abitat-shared-0.1.0.tgz"),
      join(packDir, "abitat-host-daemon-0.1.0.tgz"),
      join(packDir, "abitat-cli-0.1.0.tgz")
    ],
    { cwd: installDir, quiet: true }
  );

  const doctor = await run("node", ["node_modules/@abitat/cli/dist/index.js", "doctor"], {
    cwd: installDir
  });
  if (!doctor.stdout.includes("Not logged in. Run `abitat login`.")) {
    throw new Error(`Unexpected abitat doctor output: ${doctor.stdout}`);
  }

  const resolvedDaemon = await run(
    "node",
    ["--input-type=module", "-e", "console.log(import.meta.resolve('@abitat/host-daemon/cli'))"],
    { cwd: installDir }
  );
  if (!resolvedDaemon.stdout.includes("@abitat/host-daemon/dist/cli/index.js")) {
    throw new Error(`Unable to resolve packaged host daemon: ${resolvedDaemon.stdout}`);
  }

  console.log("public install smoke passed");
} finally {
  await rm(packDir, { force: true, recursive: true });
  await rm(installDir, { force: true, recursive: true });
}

async function pack(filter) {
  await run("pnpm", ["--filter", filter, "pack", "--pack-destination", packDir], {
    cwd: root,
    quiet: true
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (!options.quiet) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (!options.quiet) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code}\n${stdout}\n${stderr}`.trim()
        )
      );
    });
  });
}
