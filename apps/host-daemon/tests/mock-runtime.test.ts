import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createMockRuntimeAdapter } from "../src/runtime/mock";

describe("mock runtime adapter", () => {
  it("emits progress events and writes a run log in the worktree", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "abitat-mock-runtime-"));
    const events: { type: string; content: string }[] = [];

    try {
      await createMockRuntimeAdapter().run(
        {
          worktreePath,
          prompt: "Add a useful page.",
          model: "mock-model",
          instructions: "Keep changes small."
        },
        async (event) => {
          events.push(event);
        }
      );

      expect(events).toEqual([
        { type: "status", content: "Mock runtime starting" },
        { type: "stdout", content: "Prompt: Add a useful page." },
        { type: "stdout", content: "Wrote ABITAT_RUN_LOG.md" },
        { type: "status", content: "Mock runtime completed" }
      ]);
      await expect(readFile(join(worktreePath, "ABITAT_RUN_LOG.md"), "utf8")).resolves.toContain(
        "Add a useful page."
      );
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
    }
  });
});
