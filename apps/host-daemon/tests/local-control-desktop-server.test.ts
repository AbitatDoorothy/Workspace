import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer as createHttpServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startDesktopControlServer } from "../src/local-control/desktop-server";
import type { LocalCodexBridge, LocalControlStore } from "../src/local-control/index";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
});

describe("desktop control server", () => {
  it("exposes a loopback desktop API over the same local Codex bridge", async () => {
    const codex = createFakeCodexBridge();
    const runtime = await startDesktopControlServer({
      codex,
      connectRelay: false,
      desktopPort: 0,
      localControlPort: 0,
      relayEndpoint: "http://127.0.0.1:9",
      store: createFakeStore()
    });
    servers.push(runtime);

    await expect(fetchJson(`${runtime.desktopEndpoint}/api/desktop/projects`)).resolves.toEqual({
      projects: [expect.objectContaining({ id: "project-a", name: "Abitat_Workspace" })]
    });

    await expect(
      fetchJson(`${runtime.desktopEndpoint}/api/desktop/projects/project-a/conversations`)
    ).resolves.toEqual({
      conversations: [expect.objectContaining({ id: "thread-a", prompt: "Initial task" })]
    });

    await expect(
      fetchJson(`${runtime.desktopEndpoint}/api/desktop/projects/project-a/conversations`, {
        body: JSON.stringify({
          modelSettings: { effort: "medium", model: "gpt-5" },
          prompt: "Build native Mac"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      })
    ).resolves.toEqual({
      conversationId: "thread-new",
      status: "running"
    });
    expect(codex.startConversation).toHaveBeenCalledWith(
      "project-a",
      expect.objectContaining({
        modelSettings: { effort: "medium", model: "gpt-5" },
        prompt: "Build native Mac"
      })
    );
  });

  it("creates normal phone pairing payloads while keeping the mobile health endpoint online", async () => {
    const store = createFakeStore();
    const runtime = await startDesktopControlServer({
      codex: createFakeCodexBridge(),
      connectRelay: false,
      desktopPort: 0,
      localControlPort: 0,
      relayEndpoint: "http://127.0.0.1:9",
      store
    });
    servers.push(runtime);

    await expect(
      fetchJson(`${runtime.desktopEndpoint}/api/desktop/pairing`, { method: "POST" })
    ).resolves.toEqual({
      expiresAt: "2026-05-27T12:05:00.000Z",
      manualCode: "ABITAT-TEST",
      payloadJson: expect.stringContaining('"product":"abitat"'),
      relayId: "relay_test"
    });
    expect(store.createPairing).toHaveBeenCalledWith({
      endpoint: "http://127.0.0.1:9",
      relayId: "relay_test",
      transport: "relay"
    });

    await expect(fetchJson(`${runtime.localEndpoint}/health`)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        status: "online",
        transport: "relay"
      })
    );
  });

  it("lets the desktop client steer and remove queued turns through the Codex bridge", async () => {
    const codex = createFakeCodexBridge();
    const runtime = await startDesktopControlServer({
      codex,
      connectRelay: false,
      desktopPort: 0,
      localControlPort: 0,
      relayEndpoint: "http://127.0.0.1:9",
      store: createFakeStore()
    });
    servers.push(runtime);

    await expect(
      fetchJson(`${runtime.desktopEndpoint}/api/desktop/conversations/thread-a/queue/client-1`, {
        body: JSON.stringify({ prompt: "Steer this next" }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      })
    ).resolves.toEqual({
      conversationId: "thread-a",
      status: "queued",
      updated: true
    });
    expect(codex.updateQueuedTurn).toHaveBeenCalledWith("thread-a", {
      clientMessageId: "client-1",
      prompt: "Steer this next"
    });

    await expect(
      fetchJson(`${runtime.desktopEndpoint}/api/desktop/conversations/thread-a/queue/client-1`, {
        method: "DELETE"
      })
    ).resolves.toEqual({
      conversationId: "thread-a",
      removed: true,
      status: "queued"
    });
    expect(codex.deleteQueuedTurn).toHaveBeenCalledWith("thread-a", {
      clientMessageId: "client-1"
    });
  });

  it("serves plugin suggestions over the desktop loopback API without local skill paths", async () => {
    const root = await createPluginCatalogFixture();
    vi.stubEnv("CODEX_HOME", join(root, ".codex"));
    vi.stubEnv("AGENTS_HOME", join(root, ".agents"));
    const runtime = await startDesktopControlServer({
      codex: createFakeCodexBridge(),
      connectRelay: false,
      desktopPort: 0,
      localControlPort: 0,
      relayEndpoint: "http://127.0.0.1:9",
      store: createFakeStore()
    });
    servers.push(runtime);

    const body = await fetchJson(`${runtime.desktopEndpoint}/api/desktop/codex/plugin-suggestions`);

    expect(body).toEqual({
      suggestions: [
        expect.objectContaining({
          displayName: "Browser",
          id: "plugin:browser",
          invocationName: "browser",
          kind: "plugin"
        }),
        expect.objectContaining({
          displayName: "Browser",
          id: "skill:browser:browser",
          invocationName: "browser:browser",
          kind: "skill"
        })
      ]
    });
    expect(JSON.stringify(body)).not.toContain("SKILL.md");
  });

  it("falls back to the next loopback desktop port when the preferred port is busy", async () => {
    const portBlocker = createHttpServer();
    const blockedEndpoint = await listenOnLoopback(portBlocker, 0);
    servers.push({ close: () => closeHttpServer(portBlocker) });
    const blockedPort = new URL(blockedEndpoint).port;

    const runtime = await startDesktopControlServer({
      codex: createFakeCodexBridge(),
      connectRelay: false,
      desktopPort: Number(blockedPort),
      localControlPort: 0,
      relayEndpoint: "http://127.0.0.1:9",
      store: createFakeStore()
    });
    servers.push(runtime);

    expect(new URL(runtime.desktopEndpoint).port).not.toBe(blockedPort);
    await expect(fetchJson(`${runtime.desktopEndpoint}/health`)).resolves.toEqual({
      ok: true,
      status: "online"
    });
  });

  it("returns a bounded diagnostics log tail for the desktop logs view", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "abitat-desktop-log-"));
    const diagnosticsLogPath = join(rootDir, "mobile-control.log");
    await writeFile(diagnosticsLogPath, "0123456789abcdef", "utf8");
    const runtime = await startDesktopControlServer({
      codex: createFakeCodexBridge(),
      connectRelay: false,
      desktopPort: 0,
      diagnostics: { log: vi.fn() },
      diagnosticsLogPath,
      localControlPort: 0,
      relayEndpoint: "http://127.0.0.1:9",
      store: createFakeStore()
    });
    servers.push(runtime);

    await expect(
      fetchJson(`${runtime.desktopEndpoint}/api/desktop/diagnostics/log?limitBytes=6`)
    ).resolves.toEqual({
      data: "abcdef",
      logPath: diagnosticsLogPath,
      size: 16,
      truncated: true
    });
  });
});

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(body));
  }
  return body;
}

function listenOnLoopback(server: ReturnType<typeof createHttpServer>, port: number) {
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP server address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeHttpServer(server: ReturnType<typeof createHttpServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

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
    listGeneratedFiles: vi.fn(async () => []),
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
      endpoint: "http://127.0.0.1:9",
      expiresAt: "2026-05-27T12:05:00.000Z",
      macId: "mac_test",
      manualCode: "ABITAT-TEST",
      pairingSecret: "pair_secret",
      product: "abitat",
      relayId: "relay_test",
      transport: "relay",
      version: 1
    })),
    getMacIdentity: vi.fn(async () => ({
      macId: "mac_test",
      macName: "Reece MacBook"
    })),
    getRelayId: vi.fn(async () => "relay_test"),
    listPushSubscriptions: vi.fn(async () => []),
    requireDeviceByToken: vi.fn()
  } as unknown as LocalControlStore;
}

async function createPluginCatalogFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "abitat-desktop-plugin-catalog-"));
  const pluginRoot = join(
    rootDir,
    ".codex",
    "plugins",
    "cache",
    "openai-bundled",
    "browser",
    "1"
  );
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
  await mkdir(join(pluginRoot, "skills", "browser"), { recursive: true });
  await writeFile(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "browser",
      skills: "./skills/",
      interface: {
        displayName: "Browser",
        shortDescription: "Use Browser to inspect local apps."
      }
    }),
    "utf8"
  );
  await writeFile(
    join(pluginRoot, "skills", "browser", "SKILL.md"),
    `---
name: browser
description: "Browser automation for local web targets."
---
`,
    "utf8"
  );
  return rootDir;
}
