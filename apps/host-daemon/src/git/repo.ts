import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RepoRuntime {
  exists(path: string): Promise<boolean>;
  run(command: string, args: string[]): Promise<string | void>;
}

interface SyncRepoInput {
  repoUrl: string;
  defaultBranch: string;
  targetPath: string;
  runtime?: RepoRuntime;
}

export async function syncRepo(input: SyncRepoInput) {
  const runtime = input.runtime ?? defaultRepoRuntime;

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

export function fetchRepo(repoPath: string, defaultBranch: string, runtime = defaultRepoRuntime) {
  return runtime.run("git", ["-C", repoPath, "fetch", "origin", defaultBranch]);
}

export function addWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  defaultBranch: string,
  runtime = defaultRepoRuntime
) {
  return runtime.run("git", [
    "-C",
    repoPath,
    "worktree",
    "add",
    "-B",
    branchName,
    worktreePath,
    `origin/${defaultBranch}`
  ]);
}

export async function gitStatus(worktreePath: string, runtime = defaultRepoRuntime) {
  return String((await runtime.run("git", ["-C", worktreePath, "status", "--short"])) ?? "");
}

export async function gitDiff(worktreePath: string, runtime = defaultRepoRuntime) {
  return String((await runtime.run("git", ["-C", worktreePath, "diff"])) ?? "");
}

export function commitWorktree(
  worktreePath: string,
  commitMessage: string,
  runtime = defaultRepoRuntime
) {
  return runtime.run("git", ["-C", worktreePath, "commit", "-am", commitMessage]);
}

export function pushBranch(repoPath: string, branchName: string, runtime = defaultRepoRuntime) {
  return runtime.run("git", ["-C", repoPath, "push", "-u", "origin", branchName]);
}

export function removeWorktree(
  repoPath: string,
  worktreePath: string,
  runtime = defaultRepoRuntime
) {
  return runtime.run("git", ["-C", repoPath, "worktree", "remove", worktreePath]);
}

export const defaultRepoRuntime: RepoRuntime = {
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  async run(command, args) {
    const { stdout } = await execFileAsync(command, args);
    return stdout;
  }
};
