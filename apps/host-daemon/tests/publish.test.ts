import { describe, expect, it } from "vitest";

import { commitAndPushWorktree, tryCreatePullRequest } from "../src/git/publish";

describe("git publish", () => {
  it("stages, commits, reads the SHA, and pushes the branch", async () => {
    const commands: string[][] = [];
    const runtime = {
      exists: async () => true,
      run: async (command: string, args: string[]) => {
        commands.push([command, ...args]);
        return args.includes("rev-parse") ? "abc123\n" : "";
      }
    };

    await expect(
      commitAndPushWorktree({
        worktreePath: "/tmp/worktree",
        branchName: "abitat/feature/demo",
        commitMessage: "feat: add mock run log",
        runtime
      })
    ).resolves.toEqual({ commitSha: "abc123" });
    expect(commands).toEqual([
      ["git", "-C", "/tmp/worktree", "add", "."],
      ["git", "-C", "/tmp/worktree", "commit", "-m", "feat: add mock run log"],
      ["git", "-C", "/tmp/worktree", "rev-parse", "HEAD"],
      ["git", "-C", "/tmp/worktree", "push", "-u", "origin", "abitat/feature/demo"]
    ]);
  });

  it("returns a PR URL when gh creates one", async () => {
    const runtime = {
      exists: async () => true,
      run: async () => "https://github.com/example/app/pull/1\n"
    };

    await expect(
      tryCreatePullRequest({
        worktreePath: "/tmp/worktree",
        branchName: "abitat/feature/demo",
        runtime
      })
    ).resolves.toEqual({ prUrl: "https://github.com/example/app/pull/1" });
  });

  it("keeps push success usable when PR creation fails", async () => {
    const runtime = {
      exists: async () => true,
      run: async () => {
        throw new Error("gh is not authenticated");
      }
    };

    await expect(
      tryCreatePullRequest({
        worktreePath: "/tmp/worktree",
        branchName: "abitat/feature/demo",
        runtime
      })
    ).resolves.toEqual({ errorMessage: "gh is not authenticated" });
  });
});
