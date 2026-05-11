import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createMobileControlDiagnosticsLogger,
  promptDiagnostics
} from "../src/local-control/diagnostics-log";

describe("mobile control diagnostics log", () => {
  it("creates the log directory and writes redacted JSON lines", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-mobile-control-log-"));
    const logPath = join(directory, "Library", "Logs", "Abitat", "mobile-control.log");
    const logger = createMobileControlDiagnosticsLogger({
      logPath,
      now: () => new Date("2026-05-10T12:00:00.000Z")
    });

    try {
      await logger.log("info", "diagnostics.test", {
        authorization: "Bearer raw-bearer-token",
        clientToken: "client-token-secret",
        metadata: {
          nestedToken: "nested-token-secret",
          safe: "visible"
        },
        pairingSecret: "pairing-secret",
        pushToken: "ExponentPushToken[secret]"
      });
      await logger.flush();

      const raw = await readFile(logPath, "utf8");
      const entry = JSON.parse(raw.trim()) as Record<string, unknown>;

      expect(entry).toMatchObject({
        authorization: "[redacted]",
        clientToken: "[redacted]",
        event: "diagnostics.test",
        level: "info",
        pairingSecret: "[redacted]",
        pushToken: "[redacted]",
        timestamp: "2026-05-10T12:00:00.000Z"
      });
      expect(entry.metadata).toMatchObject({
        nestedToken: "[redacted]",
        safe: "visible"
      });
      expect(raw).not.toContain("raw-bearer-token");
      expect(raw).not.toContain("client-token-secret");
      expect(raw).not.toContain("nested-token-secret");
      expect(raw).not.toContain("pairing-secret");
      expect(raw).not.toContain("ExponentPushToken[secret]");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("summarizes prompts without logging the prompt text", () => {
    const summary = promptDiagnostics("Please fix the sensitive production issue");
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      promptLength: 41
    });
    expect(summary.promptHash).toMatch(/^[a-f0-9]{16}$/u);
    expect(serialized).not.toContain("sensitive production issue");
  });
});
