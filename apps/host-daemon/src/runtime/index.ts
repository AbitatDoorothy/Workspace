import type { Runtime } from "@abitat/shared";

import type { RuntimeAdapter } from "./adapter.js";
import { createClaudeRuntimeAdapter, createCodexRuntimeAdapter } from "./cli.js";
import { createMockRuntimeAdapter } from "./mock.js";
import { createPtyRuntimeAdapter } from "./pty.js";

export function createRuntimeAdapter(
  runtime: Runtime,
  options?: { pty?: { apiUrl: string; hostToken?: string } }
): RuntimeAdapter {
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
