#!/usr/bin/env node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packDir = await mkdtemp(join(tmpdir(), "abitat-pack-"));
const installDir = await mkdtemp(join(tmpdir(), "abitat-install-"));
const packages = {
  cli: await readPackage("apps/cli/package.json"),
  hostDaemon: await readPackage("apps/host-daemon/package.json"),
  shared: await readPackage("packages/shared/package.json")
};

try {
  await run("pnpm", ["--filter", "@abitat_reece/shared", "build"], { cwd: root });
  await run("pnpm", ["--filter", "@abitat_reece/host-daemon", "build"], { cwd: root });
  await run("pnpm", ["--filter", "@abitat_reece/cli", "build"], { cwd: root });

  await pack("@abitat_reece/shared");
  await pack("@abitat_reece/host-daemon");
  await pack("@abitat_reece/cli");

  await run("npm", ["init", "-y"], { cwd: installDir, quiet: true });
  await run(
    "npm",
    [
      "install",
      packedTarball(packages.shared),
      packedTarball(packages.hostDaemon),
      packedTarball(packages.cli)
    ],
    { cwd: installDir, quiet: true }
  );

  const doctor = await run("node", ["node_modules/@abitat_reece/cli/dist/index.js", "doctor"], {
    cwd: installDir
  });
  if (!doctor.stdout.includes("Not logged in. Run `abitat login`.")) {
    throw new Error(`Unexpected abitat doctor output: ${doctor.stdout}`);
  }

  const resolvedDaemon = await run(
    "node",
    [
      "--input-type=module",
      "-e",
      "console.log(import.meta.resolve('@abitat_reece/host-daemon/cli'))"
    ],
    { cwd: installDir }
  );
  if (!resolvedDaemon.stdout.includes("@abitat_reece/host-daemon/dist/cli/index.js")) {
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

async function readPackage(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

function packedTarball(packageJson) {
  const packageSlug = packageJson.name.replace(/^@/u, "").replace(/\//gu, "-");
  return join(packDir, `${packageSlug}-${packageJson.version}.tgz`);
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
