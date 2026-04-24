import { describe, expect, it } from "vitest";

import { syncRepo } from "../src/git/repo";

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
});
