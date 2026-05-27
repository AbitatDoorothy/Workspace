import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createDesktopRuntimeApi } from "../src/main/runtime";
import type { DesktopRuntimeStatus } from "../src/shared/types";
import type {
  LocalCodexBridge,
  LocalControlStore
} from "@abitat_reece/host-daemon/local-control";

describe("desktop runtime API", () => {
  it("uses one local Codex bridge for desktop projects, threads, messages, and prompts", async () => {
    const codex = createFakeCodexBridge();
    const api = createDesktopRuntimeApi({
      codex,
      createQrDataUrl: async (payload) => `data:image/png;base64,${Buffer.from(payload).toString("base64")}`,
      diagnosticsLogPath: "/tmp/abitat-test.log",
      getStatus: async () => runtimeStatus(),
      store: createFakeStore(),
      tokenUsageProvider: async () => tokenUsageSummary()
    });

    await expect(api.listProjects()).resolves.toEqual([
      expect.objectContaining({ id: "project-a", name: "Abitat_Workspace" })
    ]);
    await expect(api.listConversations("project-a")).resolves.toEqual([
      expect.objectContaining({ id: "thread-a", prompt: "Initial task" })
    ]);
    await expect(api.listMessages("thread-a")).resolves.toEqual([
      expect.objectContaining({ content: "Hello from Codex" })
    ]);

    await expect(
      api.startConversation("project-a", { prompt: "Build the Mac app" })
    ).resolves.toEqual({ conversationId: "thread-new", status: "running" });
    await expect(
      api.continueConversation("thread-a", {
        clientMessageId: "desktop-1",
        delivery: "steer",
        prompt: "Use the active turn"
      })
    ).resolves.toEqual({ conversationId: "thread-a", status: "running" });
    expect(codex.startConversation).toHaveBeenCalledWith("project-a", {
      prompt: "Build the Mac app"
    });
    expect(codex.continueConversation).toHaveBeenCalledWith("thread-a", {
      clientMessageId: "desktop-1",
      delivery: "steer",
      prompt: "Use the active turn"
    });
  });

  it("creates an explicit phone pairing payload for the Mac app relay endpoint", async () => {
    const store = createFakeStore();
    const api = createDesktopRuntimeApi({
      codex: createFakeCodexBridge(),
      createQrDataUrl: async (payload) => `qr:${payload}`,
      diagnosticsLogPath: "/tmp/abitat-test.log",
      getStatus: async () =>
        runtimeStatus({
          endpoint: "https://workspace.abitat.io",
          relayId: "relay_test"
        }),
      store,
      tokenUsageProvider: async () => tokenUsageSummary()
    });

    const pairing = await api.createPhonePairing();

    expect(store.createPairing).toHaveBeenCalledWith({
      endpoint: "https://workspace.abitat.io",
      relayId: "relay_test",
      transport: "relay"
    });
    expect(pairing.manualCode).toBe("ABITAT-TEST");
    expect(pairing.relayId).toBe("relay_test");
    expect(JSON.parse(pairing.payloadJson)).toEqual(
      expect.objectContaining({
        endpoint: "https://workspace.abitat.io",
        macId: "mac_test",
        transport: "relay"
      })
    );
    expect(pairing.qrDataUrl).toContain("qr:");
  });

  it("surfaces token usage, diagnostics, generated files, and automations locally", async () => {
    const root = await mkdtemp(join(tmpdir(), "abitat-mac-runtime-"));
    const logPath = join(root, "mobile-control.log");
    const automationsDirectory = join(root, "automations");
    await writeFile(logPath, "line one\nline two\n", "utf8");

    try {
      const api = createDesktopRuntimeApi({
        automationsDirectory,
        codex: createFakeCodexBridge(),
        createQrDataUrl: async (payload) => `qr:${payload}`,
        diagnosticsLogPath: logPath,
        getStatus: async () => runtimeStatus(),
        store: createFakeStore(),
        tokenUsageProvider: async () => tokenUsageSummary()
      });

      await expect(api.getTokenUsage()).resolves.toEqual({
        generatedAt: "2026-05-27T12:00:00.000Z",
        timeframes: {
          "1d": { cachedInputTokens: 3, inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          "7d": { cachedInputTokens: 4, inputTokens: 11, outputTokens: 21, totalTokens: 32 },
          all: { cachedInputTokens: 5, inputTokens: 12, outputTokens: 22, totalTokens: 34 }
        }
      });
      await expect(api.getDiagnosticsLog()).resolves.toEqual({
        data: "line one\nline two\n",
        logPath,
        size: 18,
        truncated: false
      });
      await expect(api.listGeneratedFiles("thread-a")).resolves.toEqual([
        expect.objectContaining({ id: "file-a", name: "report.md" })
      ]);

      const created = await api.createAutomation({
        cwds: ["/Users/reece/Desktop/Abitat_Workspace"],
        executionEnvironment: "local",
        kind: "cron",
        model: "gpt-5",
        name: "Daily Review",
        prompt: "Review the day.",
        reasoningEffort: "medium",
        rrule: "FREQ=DAILY;INTERVAL=1",
        status: "ACTIVE"
      });
      await expect(api.updateAutomation(created.id, { status: "PAUSED" })).resolves.toEqual(
        expect.objectContaining({ id: created.id, status: "PAUSED" })
      );
      await expect(api.listAutomations()).resolves.toEqual([
        expect.objectContaining({ id: created.id, name: "Daily Review", status: "PAUSED" })
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createFakeCodexBridge(): LocalCodexBridge {
  return {
    bootstrap: vi.fn(async () => ({ available: true })),
    continueConversation: vi.fn(async (conversationId) => ({ conversationId, status: "running" })),
    deleteQueuedTurn: vi.fn(async (conversationId) => ({
      conversationId,
      removed: true,
      status: "queued"
    })),
    downloadGeneratedFile: vi.fn(async (_conversationId, fileId) => ({
      dataBase64: Buffer.from("hello").toString("base64"),
      id: fileId,
      mimeType: "text/markdown",
      name: "report.md",
      path: "/tmp/report.md",
      size: 5
    })),
    listCompletionStates: vi.fn(async () => []),
    listGeneratedFiles: vi.fn(async () => [
      {
        id: "file-a",
        mimeType: "text/markdown",
        name: "report.md",
        path: "/tmp/report.md",
        size: 128
      }
    ]),
    listMessages: vi.fn(async () => [
      {
        content: "Hello from Codex",
        conversationId: "thread-a",
        createdAt: "2026-05-27T12:00:00.000Z",
        id: "message-a",
        role: "assistant",
        sequence: 1
      }
    ]),
    listModelOptions: vi.fn(async () => [
      {
        defaultReasoningEffort: "medium",
        description: "",
        displayName: "GPT-5",
        id: "gpt-5",
        isDefault: true,
        supportedReasoningEfforts: ["medium", "high"]
      }
    ]),
    listProjectConversations: vi.fn(async () => [
      {
        id: "thread-a",
        projectId: "project-a",
        prompt: "Initial task",
        source: "codex_app",
        status: "approved",
        type: "codex_app",
        updatedAt: "2026-05-27T12:00:00.000Z",
        workspaceId: "local"
      }
    ]),
    listProjects: vi.fn(async () => [
      {
        conversationCount: 1,
        createdByUserId: "local",
        hostLocalPath: "/Users/reece/Desktop/Abitat_Workspace",
        id: "project-a",
        name: "Abitat_Workspace",
        repoSyncStatus: "codex_app",
        repoUrl: "/Users/reece/Desktop/Abitat_Workspace",
        source: "codex_app",
        updatedAt: "2026-05-27T12:00:00.000Z",
        workspaceId: "local"
      }
    ]),
    startConversation: vi.fn(async () => ({ conversationId: "thread-new", status: "running" })),
    updateQueuedTurn: vi.fn(async (conversationId) => ({
      conversationId,
      status: "queued",
      updated: true
    }))
  };
}

function createFakeStore() {
  return {
    createPairing: vi.fn(async () => ({
      capabilities: ["codex_chat", "screen_control"],
      endpoint: "https://workspace.abitat.io",
      expiresAt: "2026-05-27T12:05:00.000Z",
      macId: "mac_test",
      manualCode: "ABITAT-TEST",
      pairingSecret: "pair_secret",
      product: "abitat",
      relayId: "relay_test",
      transport: "relay",
      version: 1
    }))
  } as unknown as Pick<LocalControlStore, "createPairing">;
}

function runtimeStatus(input: Partial<DesktopRuntimeStatus> = {}): DesktopRuntimeStatus {
  return {
    codex: { available: true },
    diagnosticsLogPath: "/tmp/abitat-test.log",
    endpoint: "https://workspace.abitat.io",
    localEndpoint: "http://127.0.0.1:3901",
    macId: "mac_test",
    macName: "Reece MacBook",
    relayConnected: true,
    relayEndpoint: "https://workspace.abitat.io",
    relayId: "relay_test",
    serverStartedAt: "2026-05-27T12:00:00.000Z",
    transport: "relay",
    ...input
  };
}

function tokenUsageSummary() {
  return {
    allTime: { cachedInputTokens: 5, inputTokens: 12, outputTokens: 22, totalTokens: 34 },
    generatedAt: "2026-05-27T12:00:00.000Z",
    oneDay: { cachedInputTokens: 3, inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    sevenDays: { cachedInputTokens: 4, inputTokens: 11, outputTokens: 21, totalTokens: 32 }
  };
}
