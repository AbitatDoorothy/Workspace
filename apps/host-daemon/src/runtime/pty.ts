import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { spawn as spawnNodePty } from "node-pty";
import WebSocket from "ws";

import type { RuntimeAdapter, RuntimeAvailability, RuntimeRunInput } from "./adapter.js";

type PtiRuntimeName = "codex" | "claude";

const execFileAsync = promisify(execFile);

interface TerminalSocket {
  OPEN?: number;
  readyState?: number;
  send(data: string): void;
  close(): void;
  on(event: "message", listener: (raw: unknown) => void): unknown;
  on(event: "close" | "error", listener: () => void): unknown;
}

interface TerminalPty {
  write(data: string): void;
  kill(): void;
  resize(cols: number, rows: number): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (event: { exitCode: number }) => void): void;
}

interface PtyRuntimeDependencies {
  checkCommand?: (name: PtiRuntimeName) => Promise<RuntimeAvailability>;
  createSocket?: (url: string, hostToken?: string) => Promise<TerminalSocket>;
  spawnPty?: (
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      cols: number;
      rows: number;
    }
  ) => TerminalPty;
}

export function createPtyRuntimeAdapter(
  name: PtiRuntimeName,
  apiUrl: string,
  hostToken?: string,
  dependencies: PtyRuntimeDependencies = {}
): RuntimeAdapter {
  const wsOrigin = apiUrl.replace(/^http/, "ws").replace(/\/$/, "");
  const checkCommand = dependencies.checkCommand ?? defaultCheckCommand;
  const createSocket = dependencies.createSocket ?? createTerminalSocket;
  const spawnPty = dependencies.spawnPty ?? defaultSpawnPty;

  return {
    name,
    async isAvailable(): Promise<RuntimeAvailability> {
      return checkCommand(name);
    },
    async run(input, emit) {
      if (!input.conversationId) {
        throw new Error("PTY runtime requires a conversationId");
      }

      const availability = await this.isAvailable();
      if (!availability.installed) {
        throw new Error(availability.reason ?? `${name} CLI is unavailable`);
      }

      const args = ptyArgs(name, input);
      const command = availability.path ?? name;

      await emit({ type: "status", content: `${name} PTY runtime starting` });

      let socket: TerminalSocket | null = await createSocket(
        `${wsOrigin}/api/conversations/${input.conversationId}/terminal`,
        hostToken
      ).catch(async (error: unknown) => {
        await emit({
          type: "status",
          content: `Built-in terminal relay unavailable: ${errorMessage(error)}`
        });
        return null;
      });
      const prompt = ptyPrompt(input);
      sendTerminalMessage(socket, { type: "init", prompt });

      const pty = spawnPty(command, args, {
        cwd: input.worktreePath,
        env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
        cols: 120,
        rows: 40
      });

      // PTY output → WebSocket (xterm.js) + emit (DB events).
      let outputBuffer = "";
      let lastOutput = "";
      pty.onData((data: string) => {
        sendTerminalMessage(socket, { type: "output", data });
        outputBuffer += data;
        while (outputBuffer.includes("\n")) {
          const idx = outputBuffer.indexOf("\n");
          const line = outputBuffer.slice(0, idx).replace(/\r$/, "");
          outputBuffer = outputBuffer.slice(idx + 1);
          if (line.trim().length > 0) {
            lastOutput = line.trim();
            void emit({ type: "stdout", content: line });
          }
        }
      });

      pty.write(`${prompt}\n\u0004`);

      // Browser keystrokes → PTY stdin.
      socket?.on("message", (raw: unknown) => {
        let msg: { type: string; data?: string };
        try {
          msg = JSON.parse(rawToString(raw));
        } catch {
          return;
        }
        if (msg.type === "input" && msg.data != null) {
          pty.write(msg.data);
        }
        if (msg.type === "resize" && msg.data != null) {
          try {
            const { cols, rows } = JSON.parse(msg.data);
            pty.resize(cols, rows);
          } catch {
            // Ignore malformed resize messages from stale browser tabs.
          }
        }
      });

      socket?.on("close", () => {
        socket = null;
      });

      socket?.on("error", () => {
        socket = null;
      });

      const exitCode = await new Promise<number>((resolve) => {
        pty.onExit(({ exitCode }) => {
          if (outputBuffer.trim().length > 0) {
            lastOutput = outputBuffer.trim();
            void emit({ type: "stdout", content: outputBuffer.trim() });
          }
          sendTerminalMessage(socket, { type: "exit", exitCode });
          socket?.close();
          void emit({ type: "status", content: `${name} PTY exited with code ${exitCode}` });
          resolve(exitCode);
        });
      });

      if (exitCode !== 0) {
        const details = lastOutput ? `: ${lastOutput}` : "";
        throw new Error(`${name} exited with code ${exitCode}${details}`);
      }

      await emit({ type: "status", content: `${name} PTY runtime completed` });
    }
  };
}

function ptyArgs(name: PtiRuntimeName, input: RuntimeRunInput): string[] {
  if (name === "codex") {
    const localFolderArgs = input.skipGitRepoCheck ? ["--skip-git-repo-check"] : [];
    const modelArgs = [
      "--disable",
      "plugins",
      "--disable",
      "general_analytics",
      "--model",
      resolveCodexModel(input.model),
      "--full-auto"
    ];
    if (input.resumeSessionId) {
      return ["exec", "resume", ...localFolderArgs, ...modelArgs, input.resumeSessionId, "-"];
    }
    return ["exec", ...localFolderArgs, ...modelArgs, "-"];
  }
  return ["--model", input.model, "--print"];
}

async function defaultCheckCommand(name: PtiRuntimeName): Promise<RuntimeAvailability> {
  try {
    const { stdout: path } = await execFileAsync("which", [name]);
    return { installed: true, path: path.trim() };
  } catch {
    return { installed: false, reason: `${name} CLI is unavailable on the host.` };
  }
}

function defaultSpawnPty(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    cols: number;
    rows: number;
  }
) {
  return spawnNodePty(command, args, options);
}

function createTerminalSocket(url: string, token?: string) {
  const ws = new WebSocket(
    url,
    token ? { headers: { authorization: `Bearer ${token}` } } : undefined
  );

  return new Promise<TerminalSocket>((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function sendTerminalMessage(
  socket: TerminalSocket | null,
  message: { type: string; data?: string; prompt?: string; exitCode?: number }
) {
  if (!socket || socket.readyState !== (socket.OPEN ?? 1)) {
    return;
  }

  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The database event stream remains the source of truth if the terminal socket drops.
  }
}

function rawToString(raw: unknown) {
  if (typeof raw === "string") {
    return raw;
  }

  if (raw instanceof Buffer) {
    return raw.toString("utf8");
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }

  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
  }

  return String(raw);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function resolveCodexModel(model: string) {
  return /^\d+(?:\.\d+)+$/.test(model) ? `gpt-${model}` : model;
}

function ptyPrompt(input: RuntimeRunInput): string {
  return [
    "# Instructions",
    input.instructions,
    "",
    "# Task",
    input.prompt,
    "",
    "# Allowed Tools",
    (input.allowedTools ?? []).join(", "),
    ""
  ].join("\n");
}
