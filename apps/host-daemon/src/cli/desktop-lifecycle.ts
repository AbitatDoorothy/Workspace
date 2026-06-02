import { execFile } from "node:child_process";
import { normalize } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DesktopProcessEntry {
  command: string;
  pid: number;
  ppid: number;
}

export interface StaleDesktopHelperOptions {
  currentPid: number;
  helperPath: string;
}

export async function cleanupStaleDesktopHelpers(options: { helperPath: string }) {
  const helperPath = options.helperPath;
  if (!helperPath) {
    return;
  }

  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8"
  });
  const pids = staleDesktopHelperProcessIds(parseProcessList(stdout), {
    currentPid: process.pid,
    helperPath
  });

  for (const pid of pids) {
    killIfRunning(pid, "SIGTERM");
  }

  await delay(500);

  for (const pid of pids) {
    if (isProcessRunning(pid)) {
      killIfRunning(pid, "SIGKILL");
    }
  }
}

export function staleDesktopHelperProcessIds(
  entries: DesktopProcessEntry[],
  options: StaleDesktopHelperOptions
) {
  const helperPath = normalize(options.helperPath);
  const staleHelpers = entries.filter(
    (entry) =>
      entry.pid !== options.currentPid &&
      entry.ppid === 1 &&
      isDesktopHelperCommand(entry.command, helperPath)
  );
  const staleHelperPids = new Set(staleHelpers.map((entry) => entry.pid));
  const childPids = entries
    .filter((entry) => staleHelperPids.has(entry.ppid))
    .map((entry) => entry.pid);

  return [...staleHelperPids, ...childPids];
}

function parseProcessList(output: string) {
  return output
    .split("\n")
    .flatMap((line): DesktopProcessEntry[] => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/u);
      if (!match) {
        return [];
      }
      return [
        {
          command: match[3],
          pid: Number(match[1]),
          ppid: Number(match[2])
        }
      ];
    });
}

function isDesktopHelperCommand(command: string, helperPath: string) {
  return command.includes(helperPath) && /(?:^|\s)desktop(?:\s|$)/u.test(command);
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killIfRunning(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal);
  } catch {
    // The stale process may have already exited between ps and kill.
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
