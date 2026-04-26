import { describe, expect, it } from "vitest";

import { createCliRuntimeAdapter } from "../src/runtime/cli";

describe("CLI runtime adapter", () => {
  it("reports unavailable when the CLI is missing", async () => {
    const adapter = createCliRuntimeAdapter({
      name: "codex",
      command: "codex",
      runner: {
        check: async () => ({ installed: false, reason: "codex not found" }),
        run: async () => 0
      }
    });

    await expect(adapter.isAvailable()).resolves.toEqual({
      installed: false,
      reason: "codex not found"
    });
  });

  it("streams stdout and stderr while running in the worktree", async () => {
    const events: { type: string; content: string }[] = [];
    const adapter = createCliRuntimeAdapter({
      name: "claude",
      command: "claude",
      runner: {
        check: async () => ({ installed: true, version: "1.2.3", path: "/usr/bin/claude" }),
        run: async (_command, _args, options, emit) => {
          expect(options.cwd).toBe("/tmp/worktree");
          expect(options.stdin).toContain("Keep changes small.");
          expect(options.stdin).toContain("Add a useful page.");
          await emit({ type: "stdout", content: "working" });
          await emit({ type: "stderr", content: "warning" });
          return 0;
        }
      }
    });

    await adapter.run(
      {
        worktreePath: "/tmp/worktree",
        prompt: "Add a useful page.",
        model: "sonnet",
        instructions: "Keep changes small."
      },
      async (event) => {
        events.push(event);
      }
    );

    expect(events).toEqual([
      { type: "status", content: "claude runtime starting" },
      { type: "stdout", content: "working" },
      { type: "stderr", content: "warning" },
      { type: "status", content: "claude runtime completed" }
    ]);
  });

  it("captures non-zero exits as useful failures", async () => {
    const adapter = createCliRuntimeAdapter({
      name: "codex",
      command: "codex",
      runner: {
        check: async () => ({ installed: true }),
        run: async (_command, _args, _options, emit) => {
          await emit({ type: "stderr", content: "model rejected request" });
          return 2;
        }
      }
    });

    await expect(
      adapter.run(
        {
          worktreePath: "/tmp/worktree",
          prompt: "Add a useful page.",
          model: "gpt-5.4-codex",
          instructions: "Keep changes small."
        },
        async () => {}
      )
    ).rejects.toThrow("codex exited with code 2");
  });
});
