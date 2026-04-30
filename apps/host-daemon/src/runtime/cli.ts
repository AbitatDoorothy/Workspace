import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { RuntimeAdapter, RuntimeAvailability, RuntimeRunInput } from "./adapter.js";

const execFileAsync = promisify(execFile);
const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const CONTROL_CHARACTER_PATTERN = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g"
);
const ANSI_CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "g");
const ANSI_OSC_PATTERN = new RegExp(
  `${ESCAPE_CHARACTER}\\][^${BELL_CHARACTER}]*(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`,
  "g"
);
export const terminalShellPidMarker = "__ABITAT_SHELL_PID__";

type CliRuntimeName = "codex" | "claude";
type CliOutput = { type: "stdout" | "stderr" | "summary"; content: string };

interface CliRunOptions {
  cwd: string;
  stdin: string;
}

export interface TerminalLaunchInput {
  scriptPath: string;
  logPath: string;
  exitMarker: string;
}

interface TerminalCliRuntimeRunnerInput {
  check?: (command: string) => Promise<RuntimeAvailability>;
  launch?: (input: TerminalLaunchInput) => Promise<void>;
  isProcessAlive?: (pid: number) => Promise<boolean>;
  startupTimeoutMs?: number;
}

export interface CliRuntimeRunner {
  interactive: boolean;
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
  return createCliRuntimeAdapter({
    name: "codex",
    command: "codex",
    runner: defaultRunnerForAgentCli()
  });
}

export function createClaudeRuntimeAdapter() {
  return createCliRuntimeAdapter({
    name: "claude",
    command: "claude",
    runner: defaultRunnerForAgentCli()
  });
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
      let lastOutput = "";

      if (!availability.installed) {
        throw new Error(availability.reason ?? `${input.name} CLI is unavailable`);
      }

      await emit({ type: "status", content: `${input.name} runtime starting` });
      const exitCode = await runner.run(
        input.command,
        runtimeArgs(input.name, runInput, runner.interactive),
        {
          cwd: runInput.worktreePath,
          stdin: runtimePrompt(runInput)
        },
        async (event) => {
          if (event.content.trim().length > 0) {
            lastOutput = event.content.trim();
          }

          await emit(event);
        }
      );

      if (exitCode !== 0) {
        const details = lastOutput ? `: ${lastOutput}` : "";
        throw new Error(`${input.name} exited with code ${exitCode}${details}`);
      }

      await emit({ type: "status", content: `${input.name} runtime completed` });
    }
  };
}

export const defaultCliRuntimeRunner: CliRuntimeRunner = {
  interactive: false,
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
      const queue = createAsyncQueue();

      child.stdout.on("data", (chunk: Buffer) => {
        queue.add(() => flushStdout.write(chunk.toString("utf8")));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        queue.add(() => flushStderr.write(chunk.toString("utf8")));
      });
      child.on("error", reject);
      child.on("close", (code) => {
        queue
          .add(async () => {
            await flushStdout.close();
            await flushStderr.close();
          })
          .then(() => resolve(code ?? 1))
          .catch(reject);
      });
      child.stdin.end(options.stdin);
    });
  }
};

export function createTerminalCliRuntimeRunner(
  input: TerminalCliRuntimeRunnerInput = {}
): CliRuntimeRunner {
  const check = input.check ?? defaultCliRuntimeRunner.check;
  const launch = input.launch ?? launchITerm2Script;
  const isProcessAlive = input.isProcessAlive ?? defaultIsProcessAlive;
  const startupTimeoutMs = input.startupTimeoutMs ?? 15_000;

  return {
    interactive: true,
    check,
    async run(command, args, options, emit) {
      const availability = await check(command);
      const startedAt = Date.now();

      if (!availability.installed) {
        return 127;
      }

      const runDir = await mkdtemp(join(tmpdir(), "abitat-terminal-runtime-"));
      const logPath = join(runDir, "runtime.log");
      const promptPath = join(runDir, "prompt.txt");
      const scriptPath = join(runDir, `${command}.command`);
      const exitMarker = `__ABITAT_EXIT_${randomUUID()}__`;
      const commandPath = availability.path ?? command;

      await writeFile(promptPath, options.stdin, "utf8");
      await writeFile(logPath, "", "utf8");
      await writeFile(
        scriptPath,
        terminalScript({
          args,
          commandName: command,
          commandPath,
          cwd: options.cwd,
          exitMarker,
          logPath,
          promptPath
        }),
        "utf8"
      );
      await chmod(scriptPath, 0o700);

      const watch = watchTerminalLog(logPath, exitMarker, emit, {
        isProcessAlive,
        startupTimeoutMs
      });
      await launch({ scriptPath, logPath, exitMarker });

      const { exitCode, sawSessionId } = await watch;
      const sessionId =
        command === "codex" && isInteractiveCodexArgs(args)
          ? await findLatestCodexSessionId(options.cwd, startedAt)
          : null;

      if (sessionId && !sawSessionId) {
        await emit({ type: "stdout", content: `session id: ${sessionId}` });
      }

      return exitCode;
    }
  };
}

function defaultRunnerForAgentCli() {
  if (process.env.ABITAT_CLI_RUNTIME_MODE === "inline" || process.platform !== "darwin") {
    console.log("runtime runner: inline (hidden)");
    return defaultCliRuntimeRunner;
  }

  console.log("runtime runner: terminal (visible window)");
  return createTerminalCliRuntimeRunner();
}

function createAsyncQueue() {
  let current = Promise.resolve();

  return {
    add(task: () => Promise<void>) {
      const next = current.then(task, task);
      current = next.catch(() => undefined);
      return next;
    }
  };
}

type ExecFileAsync = (file: string, args: string[]) => Promise<unknown>;

export async function launchITerm2Script(
  input: TerminalLaunchInput,
  execFileAsyncImpl: ExecFileAsync = execFileAsync
) {
  const command = shellQuote(input.scriptPath);
  const script = [
    'tell application "iTerm2"',
    "activate",
    "if (count of windows) = 0 then",
    "set newWindow to create window with default profile",
    "set targetSession to current session of newWindow",
    "else",
    "tell current window",
    "set newTab to create tab with default profile",
    "set targetSession to current session of newTab",
    "end tell",
    "end if",
    `tell targetSession to write text ${appleScriptString(command)}`,
    "end tell"
  ].join("\n");

  await execFileAsyncImpl("osascript", ["-e", script]);
}

function terminalScript(input: {
  args: string[];
  commandName: string;
  commandPath: string;
  cwd: string;
  exitMarker: string;
  logPath: string;
  promptPath: string;
}) {
  const usesPrompt = usesPromptFile(input.commandName, input.args);
  const command = terminalCommand(
    input.commandName,
    input.commandPath,
    input.args,
    input.promptPath
  );
  const holdOpen = process.env.ABITAT_TERMINAL_HOLD_OPEN !== "0";
  const capturesOutput = capturesTerminalOutput(input.commandName, input.args);
  const lines = [
    "#!/bin/bash",
    "set +e",
    `cd ${shellQuote(input.cwd)}`,
    `echo "${terminalShellPidMarker}:$$" >> ${shellQuote(input.logPath)}`,
    terminalLogLine("Abitat Workspace terminal runtime", input.logPath, capturesOutput),
    terminalLogLine(`cwd: ${input.cwd}`, input.logPath, capturesOutput),
    terminalLogLine(`command: ${command}`, input.logPath, capturesOutput),
    capturesOutput ? `echo ""` : "clear",
    ...(usesPrompt
      ? [`echo "--- Task ---"`, `cat ${shellQuote(input.promptPath)}`, `echo ""`]
      : []),
    ...(capturesOutput ? [`echo "--- Starting Codex CLI ---"`, `echo ""`] : []),
    capturesOutput
      ? // Use `script` to give noninteractive CLI runs a real pseudo-terminal
        // while capturing output for the daemon to stream to the web UI.
        `script -q -a ${shellQuote(input.logPath)} /bin/bash -lc ${shellQuote(command)}`
      : command,
    "status=$?",
    `echo "${input.exitMarker}:$status" >> ${shellQuote(input.logPath)}`,
    'echo ""',
    'echo "--- Agent finished (exit $status) ---"',
    ...(holdOpen ? ['read -p "Press enter to close this window..."'] : []),
    "exit $status",
    ""
  ];

  return lines.join("\n");
}

function terminalLogLine(line: string, logPath: string, echoToTerminal: boolean) {
  const escaped = escapeDoubleQuoted(line);
  const log = shellQuote(logPath);

  return echoToTerminal ? `echo "${escaped}" | tee -a ${log}` : `echo "${escaped}" >> ${log}`;
}

function terminalCommand(
  commandName: string,
  commandPath: string,
  args: string[],
  promptPath: string
) {
  if (commandName === "codex" && args[0] === "exec") {
    const promptArgs = args.at(-1) === "-" ? args.slice(0, -1) : args;
    return [
      shellQuote(commandPath),
      ...promptArgs.map(shellQuote),
      `"$(cat ${shellQuote(promptPath)})"`
    ].join(" ");
  }

  if (commandName === "codex") {
    return [commandPath, ...args].map(shellQuote).join(" ");
  }

  return `${[commandPath, ...args].map(shellQuote).join(" ")} < ${shellQuote(promptPath)}`;
}

function usesPromptFile(commandName: string, args: string[]) {
  return commandName !== "codex" || args[0] === "exec";
}

function capturesTerminalOutput(commandName: string, args: string[]) {
  return commandName !== "codex" || args[0] === "exec";
}

async function watchTerminalLog(
  logPath: string,
  exitMarker: string,
  emit: (event: CliOutput) => Promise<void>,
  options: {
    isProcessAlive: (pid: number) => Promise<boolean>;
    startupTimeoutMs: number;
  }
) {
  let offset = 0;
  let buffered = "";
  let shellPid: number | null = null;
  let sawSessionId = false;
  const startedAt = Date.now();
  const emittedLines: string[] = [];

  while (true) {
    const text = await readFile(logPath, "utf8").catch(() => "");
    const chunk = text.slice(offset);
    offset = text.length;

    if (chunk) {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith(`${terminalShellPidMarker}:`)) {
          shellPid = Number(line.slice(terminalShellPidMarker.length + 1)) || null;
          continue;
        }

        if (line.startsWith(`${exitMarker}:`)) {
          const summary = summarizeTerminalLines(emittedLines);
          if (summary) {
            await emit({ type: "summary", content: summary });
          }
          return {
            exitCode: Number(line.slice(exitMarker.length + 1)) || 0,
            sawSessionId
          };
        }

        if (line.length > 0) {
          emittedLines.push(line);
          await emit({ type: "stdout", content: line });
          const sessionId = parseTerminalSessionId(line);
          if (sessionId) {
            sawSessionId = true;
            if (!/^session id:/i.test(cleanTerminalLine(line))) {
              await emit({ type: "stdout", content: `session id: ${sessionId}` });
            }
          }
        }
      }
    }

    if (shellPid !== null && !(await options.isProcessAlive(shellPid))) {
      const summary = summarizeTerminalLines(emittedLines);
      if (summary) {
        await emit({ type: "summary", content: summary });
      }

      return {
        exitCode: 130,
        sawSessionId
      };
    }

    if (shellPid === null && Date.now() - startedAt > options.startupTimeoutMs) {
      const summary = summarizeTerminalLines(emittedLines);
      if (summary) {
        await emit({ type: "summary", content: summary });
      }

      return {
        exitCode: 124,
        sawSessionId
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function readVersion(command: string) {
  try {
    const { stdout } = await execFileAsync(command, ["--version"]);
    return stdout.trim().split("\n")[0] || undefined;
  } catch {
    return undefined;
  }
}

function isInteractiveCodexArgs(args: string[]) {
  return args[0] !== "exec";
}

async function findLatestCodexSessionId(cwd: string, startedAt: number) {
  const sessionsRoot = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
  const files = await listFiles(sessionsRoot).catch(() => []);
  let latest: { id: string; mtimeMs: number } | null = null;

  for (const file of files) {
    if (!file.endsWith(".jsonl")) {
      continue;
    }

    const details = await stat(file).catch(() => null);
    if (!details || details.mtimeMs < startedAt - 60_000) {
      continue;
    }

    const firstLine = (await readFile(file, "utf8").catch(() => "")).split(/\r?\n/)[0];
    const session = parseCodexSessionMeta(firstLine, cwd);

    if (session && (!latest || details.mtimeMs > latest.mtimeMs)) {
      latest = {
        id: session,
        mtimeMs: details.mtimeMs
      };
    }
  }

  return latest?.id ?? null;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);

      if (entry.isDirectory()) {
        return listFiles(path);
      }

      return entry.isFile() ? [path] : [];
    })
  );

  return files.flat();
}

function parseCodexSessionMeta(line: string, cwd: string) {
  try {
    const parsed = JSON.parse(line) as {
      type?: string;
      payload?: {
        id?: unknown;
        cwd?: unknown;
      };
    };

    if (parsed.type !== "session_meta") {
      return null;
    }

    if (parsed.payload?.cwd !== cwd || typeof parsed.payload.id !== "string") {
      return null;
    }

    return parsed.payload.id;
  } catch {
    return null;
  }
}

function summarizeTerminalLines(lines: string[]) {
  const recent = lines.map(cleanTerminalLine).map(cleanSummaryLine).filter(isSummaryLine).slice(-6);

  if (recent.length === 0) {
    return "Codex terminal session ended.";
  }

  return [
    "Codex terminal session ended.",
    "",
    "Recent activity:",
    ...recent.map((line) => `- ${line}`)
  ].join("\n");
}

function cleanTerminalLine(line: string) {
  return line
    .replace(ANSI_CSI_PATTERN, "")
    .replace(ANSI_OSC_PATTERN, "")
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTerminalSessionId(line: string) {
  const cleaned = cleanTerminalLine(line);
  const direct = /^session id:\s*(\S+)/i.exec(cleaned);

  if (direct) {
    return direct[1];
  }

  const resume = /\bcodex\s+resume\s+(\S+)/i.exec(cleaned);
  return resume?.[1]?.replace(/[.,;:]+$/u, "");
}

function cleanSummaryLine(line: string) {
  let cleaned = line
    .replace(/^[\u2022\-\s]+/u, "")
    .replace(/^[\u2713\u2714]\s*/u, "")
    .trim();

  for (const marker of [" › ", " Token usage:"]) {
    const markerIndex = cleaned.indexOf(marker);
    if (markerIndex > 0) {
      cleaned = cleaned.slice(0, markerIndex).trim();
    }
  }

  return cleaned;
}

function isSummaryLine(line: string) {
  if (!line) {
    return false;
  }

  if (/^session id:/i.test(line)) {
    return false;
  }

  if (/to continue this session/i.test(line)) {
    return false;
  }

  if (
    ["Abitat Workspace terminal runtime", "--- Starting Codex CLI ---", "--- Task ---"].some(
      (prefix) => line.startsWith(prefix)
    ) ||
    line.startsWith("cwd:") ||
    line.startsWith("command:")
  ) {
    return false;
  }

  if (/^[\u256d\u2570\u2502\u2500\s]+$/u.test(line) || /^\d+\s+[+-]?/u.test(line)) {
    return false;
  }

  return /^(?:added|changed|completed|created|deleted|edited|fixed|generated|implemented|modified|updated|wrote)\b/iu.test(
    line
  );
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function appleScriptString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeDoubleQuoted(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

async function defaultIsProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

function runtimeArgs(name: CliRuntimeName, input: RuntimeRunInput, interactive: boolean) {
  if (name === "codex") {
    const localFolderArgs = input.skipGitRepoCheck ? ["--skip-git-repo-check"] : [];
    const vpnStableArgs = ["--disable", "plugins", "--disable", "general_analytics"];

    if (interactive) {
      const interactiveArgs = [...vpnStableArgs, ...codexModelArgs(input.model), "--full-auto"];
      if (input.resumeSessionId) {
        return [...interactiveArgs, "resume", input.resumeSessionId];
      }
      return interactiveArgs;
    }

    if (input.resumeSessionId) {
      return [
        "exec",
        "resume",
        ...localFolderArgs,
        ...vpnStableArgs,
        ...codexModelArgs(input.model),
        "--full-auto",
        input.resumeSessionId,
        "-"
      ];
    }

    return [
      "exec",
      ...localFolderArgs,
      ...vpnStableArgs,
      ...codexModelArgs(input.model),
      "--full-auto"
    ];
  }

  if (interactive) {
    return [];
  }

  return [...plainModelArgs(input.model), "--print"];
}

function codexModelArgs(model?: string) {
  const trimmed = model?.trim();
  return trimmed ? ["--model", resolveCodexModel(trimmed)] : [];
}

function plainModelArgs(model?: string) {
  const trimmed = model?.trim();
  return trimmed ? ["--model", trimmed] : [];
}

function resolveCodexModel(model: string) {
  return /^\d+(?:\.\d+)+$/.test(model) ? `gpt-${model}` : model;
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
