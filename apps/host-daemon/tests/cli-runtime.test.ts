import { describe, expect, it } from "vitest";

import { createCliRuntimeAdapter, defaultCliRuntimeRunner } from "../src/runtime/cli";

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

  it("runs Codex with a resolved model slug and automatic execution", async () => {
    let capturedArgs: string[] = [];
    const adapter = createCliRuntimeAdapter({
      name: "codex",
      command: "codex",
      runner: {
        check: async () => ({ installed: true, version: "0.125.0", path: "/usr/bin/codex" }),
        run: async (_command, args) => {
          capturedArgs = args;
          return 0;
        }
      }
    });

    await adapter.run(
      {
        worktreePath: "/tmp/worktree",
        prompt: "Create success.md.",
        model: "5.4",
        instructions: "Keep changes small."
      },
      async () => {}
    );

    expect(capturedArgs).toEqual(["exec", "--model", "gpt-5.4", "--full-auto"]);
  });

  it("allows Codex to run in local folders that are not git repos", async () => {
    let capturedArgs: string[] = [];
    const adapter = createCliRuntimeAdapter({
      name: "codex",
      command: "codex",
      runner: {
        check: async () => ({ installed: true, version: "0.125.0", path: "/usr/bin/codex" }),
        run: async (_command, args) => {
          capturedArgs = args;
          return 0;
        }
      }
    });

    await adapter.run(
      {
        worktreePath: "/Users/reece/Desktop/Test",
        prompt: "Create success.md.",
        model: "5.4",
        instructions: "Keep changes small.",
        skipGitRepoCheck: true
      },
      async () => {}
    );

    expect(capturedArgs).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.4",
      "--full-auto"
    ]);
  });

  it("allows resumed Codex sessions in local folders that are not git repos", async () => {
    let capturedArgs: string[] = [];
    const adapter = createCliRuntimeAdapter({
      name: "codex",
      command: "codex",
      runner: {
        check: async () => ({ installed: true, version: "0.125.0", path: "/usr/bin/codex" }),
        run: async (_command, args) => {
          capturedArgs = args;
          return 0;
        }
      }
    });

    await adapter.run(
      {
        worktreePath: "/Users/reece/Desktop/Test",
        prompt: "Continue the existing thread.",
        model: "5.4",
        instructions: "Keep changes small.",
        resumeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce",
        skipGitRepoCheck: true
      },
      async () => {}
    );

    expect(capturedArgs).toEqual([
      "exec",
      "resume",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.4",
      "--full-auto",
      "019dc90a-2e03-7f91-828b-71bc3081edce",
      "-"
    ]);
  });

  it("resumes Codex sessions when a runtime session id is provided", async () => {
    let capturedArgs: string[] = [];
    const adapter = createCliRuntimeAdapter({
      name: "codex",
      command: "codex",
      runner: {
        check: async () => ({ installed: true, version: "0.125.0", path: "/usr/bin/codex" }),
        run: async (_command, args, options) => {
          capturedArgs = args;
          expect(options.stdin).toContain("Continue the existing thread.");
          return 0;
        }
      }
    });

    await adapter.run(
      {
        worktreePath: "/tmp/worktree",
        prompt: "Continue the existing thread.",
        model: "5.4",
        instructions: "Keep changes small.",
        resumeSessionId: "019dc90a-2e03-7f91-828b-71bc3081edce"
      },
      async () => {}
    );

    expect(capturedArgs).toEqual([
      "exec",
      "resume",
      "--model",
      "gpt-5.4",
      "--full-auto",
      "019dc90a-2e03-7f91-828b-71bc3081edce",
      "-"
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
    ).rejects.toThrow("codex exited with code 2: model rejected request");
  });

  it("serializes stdout and stderr event emission before resolving", async () => {
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const code = [
      "process.stdout.write('out-one\\n');",
      "process.stderr.write('err-one\\n');",
      "process.stdout.write('out-two\\n');",
      "process.stderr.write('err-two\\n');"
    ].join("");

    const exitCode = await defaultCliRuntimeRunner.run(
      process.execPath,
      ["-e", code],
      { cwd: process.cwd(), stdin: "" },
      async (event) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`${event.type}:${event.content}`);
        inFlight -= 1;
      }
    );

    expect(exitCode).toBe(0);
    expect(events).toHaveLength(4);
    expect(maxInFlight).toBe(1);
  });
});
