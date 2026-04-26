import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import type { RuntimeAdapter, RuntimeAvailability, RuntimeRunInput } from "./adapter.js";

const execFileAsync = promisify(execFile);

type CliRuntimeName = "codex" | "claude";
type CliOutput = { type: "stdout" | "stderr"; content: string };

interface CliRunOptions {
  cwd: string;
  stdin: string;
}

export interface CliRuntimeRunner {
  check(command: string): Promise<RuntimeAvailability>;
  run(
    command: string,
    args: string[],
    options: CliRunOptions,
    emit: (event: CliOutput) => Promise<void>
  ): Promise<number>;
}

interface CliRuntimeAdapterInput {
  name: CliRuntimeName;
  command: string;
  runner?: CliRuntimeRunner;
}

export function createCodexRuntimeAdapter() {
  return createCliRuntimeAdapter({ name: "codex", command: "codex" });
}

export function createClaudeRuntimeAdapter() {
  return createCliRuntimeAdapter({ name: "claude", command: "claude" });
}

export function createCliRuntimeAdapter(input: CliRuntimeAdapterInput): RuntimeAdapter {
  const runner = input.runner ?? defaultCliRuntimeRunner;

  return {
    name: input.name,
    isAvailable() {
      return runner.check(input.command);
    },
    async run(runInput, emit) {
      const availability = await runner.check(input.command);

      if (!availability.installed) {
        throw new Error(availability.reason ?? `${input.name} CLI is unavailable`);
      }

      await emit({ type: "status", content: `${input.name} runtime starting` });
      const exitCode = await runner.run(
        input.command,
        runtimeArgs(input.name, runInput),
        {
          cwd: runInput.worktreePath,
          stdin: runtimePrompt(runInput)
        },
        emit
      );

      if (exitCode !== 0) {
        throw new Error(`${input.name} exited with code ${exitCode}`);
      }

      await emit({ type: "status", content: `${input.name} runtime completed` });
    }
  };
}

export const defaultCliRuntimeRunner: CliRuntimeRunner = {
  async check(command) {
    try {
      const { stdout: path } = await execFileAsync("which", [command]);
      const version = await readVersion(command);

      return {
        installed: true,
        path: path.trim(),
        ...(version ? { version } : {})
      };
    } catch {
      return {
        installed: false,
        reason: `${command} CLI is unavailable on the host.`
      };
    }
  },

  run(command, args, options, emit) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const flushStdout = createLineEmitter("stdout", emit);
      const flushStderr = createLineEmitter("stderr", emit);

      child.stdout.on("data", (chunk: Buffer) => {
        void flushStdout.write(chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        void flushStderr.write(chunk.toString("utf8"));
      });
      child.on("error", reject);
      child.on("close", (code) => {
        Promise.all([flushStdout.close(), flushStderr.close()])
          .then(() => resolve(code ?? 1))
          .catch(reject);
      });
      child.stdin.end(options.stdin);
    });
  }
};

async function readVersion(command: string) {
  try {
    const { stdout } = await execFileAsync(command, ["--version"]);
    return stdout.trim().split("\n")[0] || undefined;
  } catch {
    return undefined;
  }
}

function runtimeArgs(name: CliRuntimeName, input: RuntimeRunInput) {
  if (name === "codex") {
    return ["exec", "--model", input.model];
  }

  return ["--model", input.model, "--print"];
}

function runtimePrompt(input: RuntimeRunInput) {
  return [
    "# Instructions",
    input.instructions,
    "",
    "# Task",
    input.prompt,
    "",
    "# Allowed Tools",
    (input.allowedTools ?? []).join(", ")
  ].join("\n");
}

function createLineEmitter(type: CliOutput["type"], emit: (event: CliOutput) => Promise<void>) {
  let buffered = "";

  return {
    async write(text: string) {
      buffered += text;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        if (line.length > 0) {
          await emit({ type, content: line });
        }
      }
    },
    async close() {
      if (buffered.length > 0) {
        await emit({ type, content: buffered });
        buffered = "";
      }
    }
  };
}
