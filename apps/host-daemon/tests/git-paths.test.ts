import { describe, expect, it } from "vitest";

import { branchNameForConversation, resolveRepoPath, resolveWorktreePath } from "../src/git/paths";

describe("resolveRepoPath", () => {
  it("places GitHub repos under the configured workspace root", () => {
    expect(resolveRepoPath("/tmp/AbitatWorkspace", "https://github.com/acme/app.git")).toBe(
      "/tmp/AbitatWorkspace/repos/github.com/acme/app.git-working"
    );
  });

  it("rejects traversal outside the workspace root", () => {
    expect(() =>
      resolveRepoPath("/tmp/AbitatWorkspace", "https://github.com/acme/../app.git")
    ).toThrow("Invalid GitHub repo URL");
  });
});

describe("conversation worktree paths", () => {
  it("generates stable branch names and worktree paths under the workspace root", () => {
    const branchName = branchNameForConversation({
      conversationId: "conversation_abcdef123456",
      conversationType: "feature",
      prompt: "Add a useful page!"
    });

    expect(branchName).toBe("abitat/feature/abcdef12-add-a-useful-page");
    expect(
      resolveWorktreePath("/tmp/AbitatWorkspace", "conversation_abcdef123456", branchName)
    ).toBe(
      "/tmp/AbitatWorkspace/worktrees/conversation_abcdef123456-abitat-feature-abcdef12-add-a-useful-page"
    );
  });

  it("rejects worktree paths outside the workspace root", () => {
    expect(() =>
      resolveWorktreePath("/tmp/AbitatWorkspace", "../escape", "abitat/feature/x")
    ).toThrow("Worktree path escapes workspace root");
  });
});
