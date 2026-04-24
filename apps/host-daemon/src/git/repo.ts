import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface RepoRuntime {
  exists(path: string): Promise<boolean>;
  run(command: string, args: string[]): Promise<void>;
}

interface SyncRepoInput {
  repoUrl: string;
  defaultBranch: string;
  targetPath: string;
  runtime?: RepoRuntime;
}

export async function syncRepo(input: SyncRepoInput) {
  const runtime = input.runtime ?? defaultRuntime;

  if (await runtime.exists(input.targetPath)) {
    await runtime.run("git", ["-C", input.targetPath, "fetch", "origin"]);
    return "fetched" as const;
  }

  await mkdir(dirname(input.targetPath), { recursive: true });
  await runtime.run("git", [
    "clone",
    "--branch",
    input.defaultBranch,
    input.repoUrl,
    input.targetPath
  ]);
  return "cloned" as const;
}

const defaultRuntime: RepoRuntime = {
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  async run(command, args) {
    await execFileAsync(command, args);
  }
};
