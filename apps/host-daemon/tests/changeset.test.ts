import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { collectChangeset, parseChangedFiles } from "../src/git/changeset";

describe("changeset collection", () => {
  it("parses changed files from porcelain status output", () => {
    expect(parseChangedFiles(" M src/app.ts\n?? ABITAT_RUN_LOG.md\nA  docs/demo.md\n")).toEqual([
      "src/app.ts",
      "ABITAT_RUN_LOG.md",
      "docs/demo.md"
    ]);
  });

  it("collects status and diff from a worktree", async () => {
    const commands: string[][] = [];
    const runtime = {
      exists: async () => true,
      run: async (command: string, args: string[]) => {
        commands.push([command, ...args]);

        if (args.includes("status")) {
          return "?? ABITAT_RUN_LOG.md\n";
        }

        if (args.includes("diff")) {
          return "diff --git a/ABITAT_RUN_LOG.md b/ABITAT_RUN_LOG.md";
        }

        return "";
      }
    };

    await expect(collectChangeset("/tmp/worktree", runtime)).resolves.toEqual({
      filesChanged: ["ABITAT_RUN_LOG.md"],
      diffText: "diff --git a/ABITAT_RUN_LOG.md b/ABITAT_RUN_LOG.md",
      summary: "Changed 1 file."
    });
    expect(commands[0]).toEqual(["git", "-C", "/tmp/worktree", "add", "-N", "."]);
  });

  it("collects a local directory changeset when the folder is not a git repo", async () => {
    const folder = await mkdtemp(join(tmpdir(), "abitat-local-"));

    try {
      await writeFile(join(folder, "success.md"), "Local folder success.\n");

      await expect(collectChangeset(folder)).resolves.toMatchObject({
        filesChanged: ["success.md"],
        diffText: expect.stringContaining("Local folder success."),
        summary: "Changed 1 file."
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
