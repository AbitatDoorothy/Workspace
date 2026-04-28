import { describe, expect, it } from "vitest";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCliRuntimeAdapter,
  createTerminalCliRuntimeRunner,
  defaultCliRuntimeRunner,
  launchITerm2Script,
  terminalShellPidMarker
} from "../src/runtime/cli";

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

    expect(capturedArgs).toEqual([
      "exec",
      "--disable",
      "plugins",
      "--disable",
      "general_analytics",
      "--model",
      "gpt-5.4",
      "--full-auto"
    ]);
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
      "--disable",
      "plugins",
      "--disable",
      "general_analytics",
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
      "--disable",
      "plugins",
      "--disable",
      "general_analytics",
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
      "--disable",
      "plugins",
      "--disable",
      "general_analytics",
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

  it("launches CLI work in a terminal script and streams the local terminal log", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "abitat-terminal-runner-"));
    const events: { type: string; content: string }[] = [];

    try {
      const runner = createTerminalCliRuntimeRunner({
        check: async () => ({ installed: true, path: "/usr/bin/codex" }),
        launch: async ({ scriptPath, logPath, exitMarker }) => {
          const script = await readFile(scriptPath, "utf8");

          expect(script).toContain("'/usr/bin/codex' 'exec'");
          expect(script).toContain(tmp);

          await appendFile(logPath, "Created terminal-output.md.\n", "utf8");
          await appendFile(logPath, `${exitMarker}:0\n`, "utf8");
        }
      });

      const exitCode = await runner.run(
        "codex",
        ["exec"],
        { cwd: tmp, stdin: "Build the thing." },
        async (event) => {
          events.push(event);
        }
      );

      expect(exitCode).toBe(0);
      expect(events).toEqual([
        { type: "stdout", content: "Created terminal-output.md." },
        {
          type: "summary",
          content:
            "Codex terminal session ended.\n\nRecent activity:\n- Created terminal-output.md."
        }
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("launches interactive Codex in Terminal without requiring a web prompt", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "abitat-terminal-codex-"));
    const events: { type: string; content: string }[] = [];

    try {
      const runner = createTerminalCliRuntimeRunner({
        check: async () => ({ installed: true, path: "/usr/bin/codex" }),
        launch: async ({ scriptPath, logPath, exitMarker }) => {
          const script = await readFile(scriptPath, "utf8");

          expect(runner.interactive).toBe(true);
          expect(script).toContain("'/usr/bin/codex'");
          expect(script).not.toContain("'exec'");
          expect(script).not.toContain("'--skip-git-repo-check'");
          expect(script).not.toContain("$(cat ");
          expect(script).not.toContain("< ");
          expect(script).toContain("'--model' 'gpt-5.4'");

          await appendFile(logPath, "session id: 019dc90a-2e03-7f91-828b-71bc3081edce\n", "utf8");
          await appendFile(logPath, "1 nihao\n", "utf8");
          await appendFile(logPath, "Created hello.md with a local note.\n", "utf8");
          await appendFile(
            logPath,
            "To continue this session, run codex resume 019dc90a-2e03-7f91-828b-71bc3081edce\n",
            "utf8"
          );
          await appendFile(logPath, `${exitMarker}:0\n`, "utf8");
        }
      });
      const adapter = createCliRuntimeAdapter({
        name: "codex",
        command: "codex",
        runner
      });

      await adapter.run(
        {
          worktreePath: tmp,
          prompt: "",
          model: "5.4",
          instructions: "Keep changes small.",
          skipGitRepoCheck: true
        },
        async (event) => {
          events.push(event);
        }
      );

      expect(events).toContainEqual({
        type: "stdout",
        content: "session id: 019dc90a-2e03-7f91-828b-71bc3081edce"
      });
      expect(events).toContainEqual({
        type: "summary",
        content:
          "Codex terminal session ended.\n\nRecent activity:\n- Created hello.md with a local note."
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("opens terminal scripts in a new iTerm2 tab", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    await launchITerm2Script(
      {
        scriptPath: "/tmp/abitat test/codex.command",
        logPath: "/tmp/abitat test/runtime.log",
        exitMarker: "__ABITAT_EXIT_TEST__"
      },
      async (command, args) => {
        calls.push({ command, args });
        return {};
      }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("osascript");
    expect(calls[0]?.args.join("\n")).toContain('application "iTerm2"');
    expect(calls[0]?.args.join("\n")).toContain("set newTab to create tab with default profile");
    expect(calls[0]?.args.join("\n")).toContain("tell targetSession to write text");
    expect(calls[0]?.args.join("\n")).toContain("'/tmp/abitat test/codex.command'");
  });

  it("fails instead of hanging when the terminal script never starts", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "abitat-terminal-never-started-"));
    const events: { type: string; content: string }[] = [];

    try {
      const runner = createTerminalCliRuntimeRunner({
        check: async () => ({ installed: true, path: "/usr/bin/codex" }),
        launch: async () => {},
        startupTimeoutMs: 10
      });

      const result = await Promise.race([
        runner.run(
          "codex",
          ["--model", "gpt-5.4"],
          { cwd: tmp, stdin: "" },
          async (event) => {
            events.push(event);
          }
        ),
        new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 1000))
      ]);

      expect(result).toBe(124);
      expect(events).toContainEqual({
        type: "summary",
        content: "Codex terminal session ended."
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("stops watching when the terminal shell exits before writing the exit marker", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "abitat-terminal-closed-"));
    const events: { type: string; content: string }[] = [];
    let shellAlive = true;

    try {
      const runner = createTerminalCliRuntimeRunner({
        check: async () => ({ installed: true, path: "/usr/bin/codex" }),
        isProcessAlive: async (pid) => {
          expect(pid).toBe(42);
          return shellAlive;
        },
        launch: async ({ scriptPath, logPath }) => {
          const script = await readFile(scriptPath, "utf8");

          expect(script).toContain(terminalShellPidMarker);
          await appendFile(logPath, `${terminalShellPidMarker}:42\n`, "utf8");
          await appendFile(logPath, "Created interrupted-session.md.\n", "utf8");
          shellAlive = false;
        }
      });

      const exitCode = await runner.run(
        "codex",
        ["--model", "gpt-5.4"],
        { cwd: tmp, stdin: "" },
        async (event) => {
          events.push(event);
        }
      );

      expect(exitCode).toBe(130);
      expect(events).toContainEqual({
        type: "summary",
        content:
          "Codex terminal session ended.\n\nRecent activity:\n- Created interrupted-session.md."
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("resumes the stored Codex session when Terminal starts a continued web thread", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "abitat-terminal-resume-"));
    const sessionId = "019dc90a-2e03-7f91-828b-71bc3081edce";

    try {
      const runner = createTerminalCliRuntimeRunner({
        check: async () => ({ installed: true, path: "/usr/bin/codex" }),
        launch: async ({ scriptPath, logPath, exitMarker }) => {
          const script = await readFile(scriptPath, "utf8");

          expect(script).toContain("'/usr/bin/codex'");
          expect(script).toContain("'resume'");
          expect(script).toContain(sessionId);
          expect(script).not.toContain("'exec'");
          expect(script).not.toContain("$(cat ");

          await appendFile(logPath, `${exitMarker}:0\n`, "utf8");
        }
      });
      const adapter = createCliRuntimeAdapter({
        name: "codex",
        command: "codex",
        runner
      });

      await adapter.run(
        {
          worktreePath: tmp,
          prompt: "Continue the same thread.",
          model: "5.4",
          instructions: "Keep changes small.",
          resumeSessionId: sessionId,
          skipGitRepoCheck: true
        },
        async () => {}
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("emits the latest interactive Codex session id from session storage", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "abitat-terminal-session-id-"));
    const previousCodexHome = process.env.CODEX_HOME;
    const sessionId = "019dc90a-2e03-7f91-828b-71bc3081edce";
    const events: { type: string; content: string }[] = [];

    try {
      process.env.CODEX_HOME = join(tmp, ".codex");
      const sessionDir = join(process.env.CODEX_HOME, "sessions", "2026", "04", "28");
      await mkdir(sessionDir, { recursive: true });
      const runner = createTerminalCliRuntimeRunner({
        check: async () => ({ installed: true, path: "/usr/bin/codex" }),
        launch: async ({ logPath, exitMarker }) => {
          await writeFile(
            join(sessionDir, "rollout-2026-04-28T00-00-00-019dc90a.jsonl"),
            `${JSON.stringify({
              type: "session_meta",
              payload: {
                id: sessionId,
                cwd: tmp
              }
            })}\n`,
            "utf8"
          );
          await appendFile(logPath, `${exitMarker}:0\n`, "utf8");
        }
      });

      const exitCode = await runner.run(
        "codex",
        ["--model", "gpt-5.4"],
        { cwd: tmp, stdin: "" },
        async (event) => {
          events.push(event);
        }
      );

      expect(exitCode).toBe(0);
      expect(events).toContainEqual({
        type: "stdout",
        content: `session id: ${sessionId}`
      });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
