import { describe, expect, it } from "vitest";

import { createCodexRuntimeAdapter } from "../src/runtime/cli";

describe.skipIf(!process.env.ABITAT_RUN_REAL_RUNTIME_TEST)("real runtime integration", () => {
  it("can check Codex CLI availability when explicitly enabled", async () => {
    const availability = await createCodexRuntimeAdapter().isAvailable();

    expect(typeof availability.installed).toBe("boolean");
  });
});
