import { describe, expect, it } from "vitest";

import {
  commitWorktree,
  defaultRepoRuntime,
  fetchRepo,
  gitDiff,
  gitStatus,
  pushBranch,
  syncRepo
} from "../src/git/repo";

describe("syncRepo", () => {
  it("clones missing repos and fetches existing repos", async () => {
    const commands: string[][] = [];
    const existing = new Set<string>();
    const runtime = {
      exists: async (path: string) => existing.has(path),
      run: async (command: string, args: string[]) => {
        commands.push([command, ...args]);
      }
    };

    await syncRepo({
      repoUrl: "https://github.com/acme/app.git",
      defaultBranch: "main",
      targetPath: "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working",
      runtime
    });
    existing.add("/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working");
    await syncRepo({
      repoUrl: "https://github.com/acme/app.git",
      defaultBranch: "main",
      targetPath: "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working",
      runtime
    });

    expect(commands).toEqual([
      [
        "git",
        "clone",
        "--branch",
        "main",
        "https://github.com/acme/app.git",
        "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working"
      ],
      ["git", "-C", "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working", "fetch", "origin"]
    ]);
  });

  it("wraps common git commands used by later daemon jobs", async () => {
    const commands: string[][] = [];
    const runtime = {
      exists: async () => true,
      run: async (command: string, args: string[]) => {
        commands.push([command, ...args]);
        return "output";
      }
    };

    await fetchRepo("/repo", "main", runtime);
    await gitStatus("/worktree", runtime);
    await gitDiff("/worktree", runtime);
    await commitWorktree("/worktree", "feat: demo", runtime);
    await pushBranch("/repo", "abitat/feature/demo", runtime);

    expect(commands).toEqual([
      ["git", "-C", "/repo", "fetch", "origin", "main"],
      ["git", "-C", "/worktree", "status", "--short"],
      ["git", "-C", "/worktree", "diff"],
      ["git", "-C", "/worktree", "commit", "-am", "feat: demo"],
      ["git", "-C", "/repo", "push", "-u", "origin", "abitat/feature/demo"]
    ]);
  });
});

describe("defaultRepoRuntime", () => {
  it("runs child processes with noninteractive git prompt settings", async () => {
    const output = await defaultRepoRuntime.run(process.execPath, [
      "-e",
      "console.log(JSON.stringify({ prompt: process.env.GIT_TERMINAL_PROMPT, ssh: process.env.GIT_SSH_COMMAND }))"
    ]);

    expect(JSON.parse(String(output))).toMatchObject({
      prompt: "0",
      ssh: expect.stringContaining("BatchMode=yes")
    });
  });

  it("fails stalled child processes with a timeout", async () => {
    const previousTimeout = process.env.ABITAT_GIT_TIMEOUT_MS;
    process.env.ABITAT_GIT_TIMEOUT_MS = "10";

    try {
      await expect(
        defaultRepoRuntime.run(process.execPath, ["-e", "setTimeout(() => {}, 1000)"])
      ).rejects.toThrow("timed out");
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.ABITAT_GIT_TIMEOUT_MS;
      } else {
        process.env.ABITAT_GIT_TIMEOUT_MS = previousTimeout;
      }
    }
  });
});
