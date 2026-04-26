import type { Runtime } from "@abitat/shared";

import type { RuntimeAdapter } from "./adapter.js";
import { createClaudeRuntimeAdapter, createCodexRuntimeAdapter } from "./cli.js";
import { createMockRuntimeAdapter } from "./mock.js";

export function createRuntimeAdapter(runtime: Runtime): RuntimeAdapter {
  if (runtime === "codex") {
    return createCodexRuntimeAdapter();
  }

  if (runtime === "claude") {
    return createClaudeRuntimeAdapter();
  }

  return createMockRuntimeAdapter();
}
