import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { HostTool, ToolName } from "@abitat_reece/shared";

const execFileAsync = promisify(execFile);
const VERSION_ARGS: Record<ToolName, string[]> = {
  git: ["--version"],
  gh: ["--version"],
  codex: ["--version"],
  claude: ["--version"],
  node: ["--version"],
  python: ["--version"]
};

export interface ToolScannerRuntime {
  resolveCommand(name: ToolName): Promise<string | null>;
  readVersion(name: ToolName, path: string): Promise<string>;
}

export function createToolScanner(runtime: ToolScannerRuntime = defaultRuntime) {
  return {
    async scan(names: ToolName[] = ["git", "gh", "node", "python", "codex", "claude"]) {
      const results: HostTool[] = [];

      for (const name of names) {
        const path = await runtime.resolveCommand(name);

        if (!path) {
          results.push({ name, installed: false });
          continue;
        }

        results.push({
          name,
          installed: true,
          path,
          version: await runtime.readVersion(name, path)
        });
      }

      return results;
    }
  };
}

const defaultRuntime: ToolScannerRuntime = {
  async resolveCommand(name) {
    try {
      const { stdout } = await execFileAsync("which", [name]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  },
  async readVersion(name, path) {
    try {
      const { stdout, stderr } = await execFileAsync(path, VERSION_ARGS[name]);
      return (stdout || stderr).split("\n")[0]?.trim() || "unknown";
    } catch {
      return "unknown";
    }
  }
};
