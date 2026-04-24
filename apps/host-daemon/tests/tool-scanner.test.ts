import { describe, expect, it } from "vitest";

import { createToolScanner } from "../src/tools/scanner";

describe("createToolScanner", () => {
  it("marks tools installed when the command resolver finds a path", async () => {
    const scanner = createToolScanner({
      resolveCommand: async (name) => (name === "git" ? "/usr/bin/git" : null),
      readVersion: async (name) => `${name} version 1.0.0`
    });

    const tools = await scanner.scan(["git", "codex"]);

    expect(tools).toEqual([
      {
        name: "git",
        installed: true,
        path: "/usr/bin/git",
        version: "git version 1.0.0"
      },
      {
        name: "codex",
        installed: false
      }
    ]);
  });
});
