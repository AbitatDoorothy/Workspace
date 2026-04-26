import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RuntimeAdapter } from "./adapter.js";

export function createMockRuntimeAdapter(): RuntimeAdapter {
  return {
    name: "mock",
    async isAvailable() {
      return { installed: true };
    },
    async run(input, emit) {
      await emit({ type: "status", content: "Mock runtime starting" });
      await emit({ type: "stdout", content: `Prompt: ${input.prompt}` });
      await writeFile(join(input.worktreePath, "ABITAT_RUN_LOG.md"), runLog(input), "utf8");
      await emit({ type: "stdout", content: "Wrote ABITAT_RUN_LOG.md" });
      await emit({ type: "status", content: "Mock runtime completed" });
    }
  };
}

function runLog(input: { prompt: string; model: string; instructions: string }) {
  return [
    "# Abitat Mock Runtime Log",
    "",
    `Model: ${input.model}`,
    "",
    "## Prompt",
    "",
    input.prompt,
    "",
    "## Instructions",
    "",
    input.instructions,
    ""
  ].join("\n");
}
