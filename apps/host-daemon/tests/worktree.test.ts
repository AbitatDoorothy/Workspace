import { describe, expect, it } from "vitest";

import { cleanupConversationWorktree, setupConversationWorktree } from "../src/git/worktree";

describe("conversation worktree setup", () => {
  it("clones, fetches, and creates a conversation branch worktree", async () => {
    const commands: string[][] = [];
    const existing = new Set<string>();
    const runtime = {
      exists: async (path: string) => existing.has(path),
      run: async (command: string, args: string[]) => {
        commands.push([command, ...args]);
      }
    };

    const setup = await setupConversationWorktree({
      workspaceRoot: "/tmp/AbitatWorkspace",
      conversationId: "conversation_abcdef123456",
      conversationType: "feature",
      prompt: "Add a useful page!",
      repoUrl: "https://github.com/acme/app.git",
      defaultBranch: "main",
      runtime
    });

    expect(setup).toEqual({
      branchName: "abitat/feature/abcdef12-add-a-useful-page",
      repoPath: "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working",
      worktreePath:
        "/tmp/AbitatWorkspace/worktrees/conversation_abcdef123456-abitat-feature-abcdef12-add-a-useful-page"
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
      [
        "git",
        "-C",
        "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working",
        "fetch",
        "origin",
        "main"
      ],
      [
        "git",
        "-C",
        "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working",
        "worktree",
        "add",
        "-B",
        "abitat/feature/abcdef12-add-a-useful-page",
        "/tmp/AbitatWorkspace/worktrees/conversation_abcdef123456-abitat-feature-abcdef12-add-a-useful-page",
        "origin/main"
      ]
    ]);
  });

  it("does not recreate an existing conversation worktree on retry", async () => {
    const commands: string[][] = [];
    const worktreePath =
      "/tmp/AbitatWorkspace/worktrees/conversation_abcdef123456-abitat-feature-abcdef12-add-a-useful-page";
    const runtime = {
      exists: async (path: string) => path === worktreePath,
      run: async (command: string, args: string[]) => {
        commands.push([command, ...args]);
      }
    };

    await setupConversationWorktree({
      workspaceRoot: "/tmp/AbitatWorkspace",
      conversationId: "conversation_abcdef123456",
      conversationType: "feature",
      prompt: "Add a useful page!",
      repoUrl: "https://github.com/acme/app.git",
      defaultBranch: "main",
      runtime
    });

    expect(commands).toEqual([["git", "-C", worktreePath, "status", "--short"]]);
  });

  it("refuses to clean up a worktree outside the workspace root", async () => {
    await expect(
      cleanupConversationWorktree({
        workspaceRoot: "/tmp/AbitatWorkspace",
        repoPath: "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working",
        worktreePath: "/tmp/outside-worktree",
        runtime: {
          exists: async () => true,
          run: async () => {}
        }
      })
    ).rejects.toThrow("Worktree path escapes workspace root");
  });
});
