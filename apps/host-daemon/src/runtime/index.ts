import type { Runtime } from "@abitat_reece/shared";

import type { RuntimeAdapter } from "./adapter.js";
import {
  createClaudeRuntimeAdapter,
  createCodexRuntimeAdapter,
  createCliRuntimeAdapter,
  defaultCliRuntimeRunner
} from "./cli.js";
import { createMockRuntimeAdapter } from "./mock.js";
import { createPtyRuntimeAdapter } from "./pty.js";

export function createRuntimeAdapter(
  runtime: Runtime,
  options?: {
    presentation?: "terminal" | "inline" | "remote_chat";
    pty?: { apiUrl: string; hostToken?: string };
  }
): RuntimeAdapter {
  if (
    options?.presentation === "remote_chat" &&
    options.pty &&
    (runtime === "codex" || runtime === "claude")
  ) {
    return createPtyRuntimeAdapter(runtime, options.pty.apiUrl, options.pty.hostToken);
  }

  if (options?.presentation === "inline" || options?.presentation === "remote_chat") {
    if (runtime === "codex") {
      return createCliRuntimeAdapter({
        name: "codex",
        command: "codex",
        runner: defaultCliRuntimeRunner
      });
    }

    if (runtime === "claude") {
      return createCliRuntimeAdapter({
        name: "claude",
        command: "claude",
        runner: defaultCliRuntimeRunner
      });
    }
  }

  if (
    process.env.ABITAT_CLI_RUNTIME_MODE === "pty" &&
    options?.pty &&
    (runtime === "codex" || runtime === "claude")
  ) {
    return createPtyRuntimeAdapter(runtime, options.pty.apiUrl, options.pty.hostToken);
  }

  if (runtime === "codex") {
    return createCodexRuntimeAdapter();
  }

  if (runtime === "claude") {
    return createClaudeRuntimeAdapter();
  }

  return createMockRuntimeAdapter();
}
