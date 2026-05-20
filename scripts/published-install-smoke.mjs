#!/usr/bin/env node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const installDir = await mkdtemp(join(tmpdir(), "abitat-published-install-"));
const packages = {
  cli: await readPackage("apps/cli/package.json"),
  hostDaemon: await readPackage("apps/host-daemon/package.json"),
  shared: await readPackage("packages/shared/package.json")
};

try {
  await run("npm", ["init", "-y"], { cwd: installDir, quiet: true });
  await run(
    "npm",
    [
      "install",
      packageSpec(packages.shared),
      packageSpec(packages.hostDaemon),
      packageSpec(packages.cli)
    ],
    { cwd: installDir, quiet: true }
  );

  const doctor = await run("node", ["node_modules/@abitat_reece/cli/dist/index.js", "doctor"], {
    cwd: installDir,
    env: {
      ABITAT_CLI_CONFIG_PATH: join(installDir, "abitat-cli-config.json")
    }
  });
  if (!doctor.stdout.includes("Local iPhone control does not require an Abitat hosted login.")) {
    throw new Error(`Unexpected abitat doctor output: ${doctor.stdout}`);
  }

  const hostSmoke = await runAllowFailure(
    "node",
    ["node_modules/@abitat_reece/host-daemon/dist/cli/index.js", "__smoke__"],
    { cwd: installDir }
  );
  if (hostSmoke.code !== 1 || !hostSmoke.stderr.includes("Unknown command: __smoke__")) {
    throw new Error(
      `Packaged host daemon failed to load cleanly.\nstdout:\n${hostSmoke.stdout}\nstderr:\n${hostSmoke.stderr}`
    );
  }

  console.log(
    `published install smoke passed for ${packageSpec(packages.shared)}, ${packageSpec(
      packages.hostDaemon
    )}, ${packageSpec(packages.cli)}`
  );
} finally {
  await rm(installDir, { force: true, recursive: true });
}

async function readPackage(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

function packageSpec(packageJson) {
  return `${packageJson.name}@${packageJson.version}`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
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

function runAllowFailure(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
