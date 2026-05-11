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

  it("does not write idle polling chatter to the file log", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-mobile-control-log-"));
    const logPath = join(directory, "Library", "Logs", "Abitat", "mobile-control.log");
    const logger = createMobileControlDiagnosticsLogger({
      logPath,
      now: () => new Date("2026-05-10T12:00:00.000Z")
    });

    try {
      await logger.log("info", "mobile_request.authenticated", {
        deviceId: "phone_test",
        method: "GET",
        path: "/api/mobile/codex/completions"
      });
      await logger.log("debug", "completion.poll.start");
      await logger.log("info", "codex.app_server.bootstrap", {
        available: true
      });
      await logger.log("info", "completion.poll.result", {
        activeCount: 0,
        completeCount: 24,
        stateCount: 24
      });
      await logger.log("info", "codex.thread_read.result", {
        includeTurns: true,
        threadId: "thread_idle",
        turnCount: 18
      });
      await logger.flush();

      await expect(readOptionalFile(logPath)).resolves.toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes task submission and active-running diagnostics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-mobile-control-log-"));
    const logPath = join(directory, "Library", "Logs", "Abitat", "mobile-control.log");
    let currentTime = new Date("2026-05-10T12:00:00.000Z").getTime();
    const logger = createMobileControlDiagnosticsLogger({
      logPath,
      now: () => new Date(currentTime)
    });

    try {
      await logger.log("info", "conversation.continue.request", {
        conversationId: "codex_thread_demo",
        promptHash: "abc123",
        promptLength: 12
      });
      currentTime += 1000;
      await logger.log("info", "completion.poll.result", {
        activeCount: 1,
        completeCount: 0,
        stateCount: 1
      });
      currentTime += 1000;
      await logger.log("info", "codex.thread_read.result", {
        includeTurns: true,
        threadId: "thread_running",
        turnCount: 1
      });
      await logger.flush();

      const raw = await readFile(logPath, "utf8");
      const entries = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(entries.map((entry) => entry.event)).toEqual([
        "conversation.continue.request",
        "completion.poll.result",
        "codex.thread_read.result"
      ]);
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

async function readOptionalFile(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
