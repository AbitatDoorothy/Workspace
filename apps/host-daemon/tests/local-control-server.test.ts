import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { MobileControlDiagnosticsLogger } from "../src/local-control/diagnostics-log";
import type { LocalRemoteControlManager } from "../src/local-control/remote-control/types";
import { createLocalControlStore } from "../src/local-control/state";
import { startLocalControlServer, type LocalCodexBridge } from "../src/local-control/server";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("local control server", () => {
  it("rejects unauthenticated phones and serves project/message APIs to paired phones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-control-server-"));
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      randomSecret: (() => {
        let index = 0;
        return () => `secret_${++index}`;
      })(),
      statePath: join(directory, "state.json")
    });
    const bridge = createFakeCodexBridge();
    const diagnostics = createMemoryDiagnostics();
    const server = await startLocalControlServer({
      bindHost: "127.0.0.1",
      codex: bridge,
      diagnostics,
      endpoint: "http://127.0.0.1:0",
      port: 0,
      store,
      transport: "local"
    });
    servers.push(server);

    try {
      const endpoint = server.endpoint;
      const pairing = await store.createPairing({ endpoint, transport: "local" });

      await expect(fetchJson(`${endpoint}/health`)).resolves.toMatchObject({
        ok: true,
        macId: "mac_test"
      });

      await expect(fetchJson(`${endpoint}/api/mobile/projects`)).rejects.toThrow("401");
      expect(diagnostics.events).toContainEqual(
        expect.objectContaining({
          event: "mobile_request.rejected",
          hasAuthorization: false,
          method: "GET",
          path: "/api/mobile/projects",
          status: 401
        })
      );

      const paired = await fetchJson(`${endpoint}/pairing/consume`, {
        body: JSON.stringify({
          deviceName: "Reece iPhone",
          pairingSecret: pairing.pairingSecret,
          platform: "ios"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      expect(paired).toMatchObject({
        clientToken: "secret_4",
        hostMachineId: "mac_test",
        machineId: "phone_test",
        workspaceId: "local"
      });

      const auth = { authorization: `Bearer ${paired.clientToken}` };
      await expect(
        fetchJson(`${endpoint}/api/mobile/bootstrap`, { headers: auth })
      ).resolves.toMatchObject({
        host: { id: "mac_test", status: "online" },
        phone: { id: "phone_test", status: "online" }
      });
      await expect(
        fetchJson(`${endpoint}/api/mobile/projects`, { headers: auth })
      ).resolves.toEqual({
        projects: [
          expect.objectContaining({
            id: "codex_project_demo",
            hostLocalPath: "/Users/reece/Desktop/Demo"
          })
        ]
      });
      expect(diagnostics.events).toContainEqual(
        expect.objectContaining({
          deviceId: "phone_test",
          event: "mobile_request.authenticated",
          method: "GET",
          path: "/api/mobile/projects"
        })
      );
      expect(diagnostics.events).toContainEqual(
        expect.objectContaining({
          count: 1,
          event: "projects.list.result"
        })
      );
      await expect(
        fetchJson(`${endpoint}/api/mobile/notifications/register`, {
          body: JSON.stringify({
            platform: "ios",
            provider: "expo",
            token: "ExponentPushToken[demo]"
          }),
          headers: { ...auth, "content-type": "application/json" },
          method: "POST"
        })
      ).resolves.toEqual({
        ok: true,
        subscription: {
          platform: "ios",
          provider: "expo"
        }
      });
      await expect(store.listPushSubscriptions()).resolves.toEqual([
        expect.objectContaining({
          deviceId: "phone_test",
          platform: "ios",
          provider: "expo",
          token: "ExponentPushToken[demo]"
        })
      ]);
      await expect(
        fetchJson(`${endpoint}/api/mobile/notifications/diagnostics`, {
          body: JSON.stringify({
            message: "permission was not granted",
            stage: "permission"
          }),
          headers: { ...auth, "content-type": "application/json" },
          method: "POST"
        })
      ).resolves.toEqual({ ok: true });

      const logPath = join(directory, "mobile-control.log");
      await writeFile(logPath, "first diagnostic\nsecond diagnostic\n", "utf8");
      diagnostics.logPath = logPath;
      await expect(
        fetchJson(`${endpoint}/api/mobile/diagnostics/log`, { headers: auth })
      ).resolves.toEqual({
        log: {
          clearedAt: expect.any(String),
          dataBase64: Buffer.from("first diagnostic\nsecond diagnostic\n").toString("base64"),
          mimeType: "text/plain",
          name: "abitat-mobile-control.log",
          size: 35,
          totalSize: 35,
          truncated: false
        }
      });
      await expect(readFile(logPath, "utf8")).resolves.toBe("");

      await expect(
        fetchJson(`${endpoint}/api/mobile/projects/codex_project_demo/conversations`, {
          body: JSON.stringify({ clientMessageId: "ios-1", prompt: "Hello from phone" }),
          headers: { ...auth, "content-type": "application/json" },
          method: "POST"
        })
      ).resolves.toEqual({
        conversationId: "codex_thread_new",
        status: "running"
      });
      expect(bridge.startedPrompts).toEqual(["Hello from phone"]);
      expect(diagnostics.events).toContainEqual(
        expect.objectContaining({
          event: "conversation.start.request",
          projectId: "codex_project_demo",
          promptHash: expect.any(String),
          promptLength: 16
        })
      );

      await expect(
        fetchJson(
          `${endpoint}/api/mobile/conversations/codex_thread_new/messages?afterSequence=3&forceRefresh=true&includeRuntime=true`,
          {
            headers: auth
          }
        )
      ).resolves.toEqual({
        messages: [
          expect.objectContaining({
            content: "Hello from phone",
            role: "user"
          })
        ]
      });
      expect(bridge.listMessageRequests.at(-1)).toEqual({
        conversationId: "codex_thread_new",
        options: {
          afterSequence: 3,
          forceRefresh: true,
          includeRuntime: true
        }
      });
      await expect(
        fetchJson(`${endpoint}/api/mobile/conversations/codex_thread_new/continue`, {
          body: JSON.stringify({ clientMessageId: "ios-2", prompt: "Continue from phone" }),
          headers: { ...auth, "content-type": "application/json" },
          method: "POST"
        })
      ).resolves.toEqual({
        conversationId: "codex_thread_new",
        status: "running"
      });
      expect(diagnostics.events).toContainEqual(
        expect.objectContaining({
          conversationId: "codex_thread_new",
          event: "conversation.continue.result",
          status: "running"
        })
      );
      await expect(
        fetchJson(`${endpoint}/api/mobile/conversations/codex_thread_new/queue/ios-2`, {
          headers: auth,
          method: "DELETE"
        })
      ).resolves.toEqual({
        conversationId: "codex_thread_new",
        removed: true,
        status: "queued"
      });
      expect(bridge.deletedQueuedTurns).toEqual([
        { clientMessageId: "ios-2", conversationId: "codex_thread_new" }
      ]);
      await expect(
        fetchJson(`${endpoint}/api/mobile/conversations/codex_thread_new/queue/ios-2`, {
          body: JSON.stringify({ prompt: "Edited queued prompt" }),
          headers: { ...auth, "content-type": "application/json" },
          method: "PATCH"
        })
      ).resolves.toEqual({
        conversationId: "codex_thread_new",
        status: "queued",
        updated: true
      });
      expect(bridge.updatedQueuedTurns).toEqual([
        {
          clientMessageId: "ios-2",
          conversationId: "codex_thread_new",
          prompt: "Edited queued prompt"
        }
      ]);
      await expect(
        fetchJson(`${endpoint}/api/mobile/conversations/codex_thread_new/files`)
      ).rejects.toThrow("401");
      await expect(
        fetchJson(`${endpoint}/api/mobile/conversations/codex_thread_new/files`, {
          headers: auth
        })
      ).resolves.toEqual({
        files: [
          {
            id: "file_demo",
            mimeType: "text/markdown",
            name: "summary.md",
            path: "/Users/reece/Desktop/Demo/summary.md",
            size: 12
          }
        ]
      });
      await expect(
        fetchJson(
          `${endpoint}/api/mobile/conversations/codex_thread_new/files/file_demo/download`,
          {
            headers: auth
          }
        )
      ).resolves.toEqual({
        file: {
          dataBase64: Buffer.from("hello file").toString("base64"),
          id: "file_demo",
          mimeType: "text/markdown",
          name: "summary.md",
          path: "/Users/reece/Desktop/Demo/summary.md",
          size: 12
        }
      });
      expect(JSON.stringify(diagnostics.events)).not.toContain(paired.clientToken);
      expect(JSON.stringify(diagnostics.events)).not.toContain("Hello from phone");
      expect(JSON.stringify(diagnostics.events)).not.toContain("Continue from phone");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("logs conversation continue failures without bearer tokens or prompts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-control-server-failure-"));
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      randomSecret: (() => {
        let index = 0;
        return () => `secret_${++index}`;
      })(),
      statePath: join(directory, "state.json")
    });
    const bridge = createFakeCodexBridge({
      continueError: new Error("Codex app-server refused turn/start")
    });
    const diagnostics = createMemoryDiagnostics();
    const server = await startLocalControlServer({
      bindHost: "127.0.0.1",
      codex: bridge,
      diagnostics,
      endpoint: "http://127.0.0.1:0",
      port: 0,
      store,
      transport: "local"
    });
    servers.push(server);

    try {
      const endpoint = server.endpoint;
      const pairing = await store.createPairing({ endpoint, transport: "local" });
      const paired = await fetchJson(`${endpoint}/pairing/consume`, {
        body: JSON.stringify({
          deviceName: "Reece iPhone",
          pairingSecret: pairing.pairingSecret,
          platform: "ios"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const auth = { authorization: `Bearer ${paired.clientToken}` };

      await expect(
        fetchJson(`${endpoint}/api/mobile/conversations/codex_thread_new/continue`, {
          body: JSON.stringify({
            clientMessageId: "ios-failure",
            prompt: "Sensitive continue prompt"
          }),
          headers: { ...auth, "content-type": "application/json" },
          method: "POST"
        })
      ).rejects.toThrow("500");

      expect(diagnostics.events).toContainEqual(
        expect.objectContaining({
          conversationId: "codex_thread_new",
          error: "Codex app-server refused turn/start",
          event: "conversation.continue.failure",
          status: 500
        })
      );
      expect(JSON.stringify(diagnostics.events)).not.toContain(paired.clientToken);
      expect(JSON.stringify(diagnostics.events)).not.toContain("Sensitive continue prompt");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves Codex token usage totals to paired phones by timeframe", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-control-token-usage-"));
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      randomSecret: (() => {
        let index = 0;
        return () => `secret_${++index}`;
      })(),
      statePath: join(directory, "state.json")
    });
    const server = await startLocalControlServer({
      bindHost: "127.0.0.1",
      codex: createFakeCodexBridge(),
      endpoint: "http://127.0.0.1:0",
      port: 0,
      store,
      tokenUsageProvider: async () => ({
        allTime: tokenUsageBucket(1_000, 700, 140, 220),
        generatedAt: "2026-05-15T12:00:00.000Z",
        oneDay: tokenUsageBucket(100, 70, 14, 22),
        sevenDays: tokenUsageBucket(500, 350, 70, 110)
      }),
      transport: "local"
    });
    servers.push(server);

    try {
      const endpoint = server.endpoint;
      const pairing = await store.createPairing({ endpoint, transport: "local" });
      const paired = await fetchJson(`${endpoint}/pairing/consume`, {
        body: JSON.stringify({
          deviceName: "Reece iPhone",
          pairingSecret: pairing.pairingSecret,
          platform: "ios"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const auth = { authorization: `Bearer ${paired.clientToken}` };

      await expect(fetchJson(`${endpoint}/api/mobile/codex/token-usage`)).rejects.toThrow("401");
      await expect(
        fetchJson(`${endpoint}/api/mobile/codex/token-usage`, { headers: auth })
      ).resolves.toEqual({
        generatedAt: "2026-05-15T12:00:00.000Z",
        timeframes: {
          all: tokenUsageBucket(1_000, 700, 140, 220),
          "1d": tokenUsageBucket(100, 70, 14, 22),
          "7d": tokenUsageBucket(500, 350, 70, 110)
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves local remote-control sessions, frames, and input only to the paired phone", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abitat-local-remote-control-"));
    const store = createLocalControlStore({
      idGenerator: (prefix) => `${prefix}_test`,
      randomSecret: (() => {
        let index = 0;
        return () => `secret_${++index}`;
      })(),
      statePath: join(directory, "state.json")
    });
    const remoteControl = createFakeRemoteControlManager();
    const server = await startLocalControlServer({
      bindHost: "127.0.0.1",
      codex: createFakeCodexBridge(),
      endpoint: "http://127.0.0.1:0",
      port: 0,
      remoteControl,
      store,
      transport: "local"
    });
    servers.push(server);

    try {
      const endpoint = server.endpoint;
      const pairing = await store.createPairing({ endpoint, transport: "local" });
      const paired = await fetchJson(`${endpoint}/pairing/consume`, {
        body: JSON.stringify({
          deviceName: "Reece iPhone",
          pairingSecret: pairing.pairingSecret,
          platform: "ios"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const auth = { authorization: `Bearer ${paired.clientToken}` };

      await expect(
        fetchJson(`${endpoint}/api/remote-control/sessions`, {
          body: JSON.stringify({
            hostMachineId: "not_this_mac",
            inputEnabled: true,
            screenEnabled: true
          }),
          headers: { ...auth, "content-type": "application/json" },
          method: "POST"
        })
      ).rejects.toThrow("403");

      await expect(
        fetchJson(`${endpoint}/api/remote-control/sessions`, {
          body: JSON.stringify({
            hostMachineId: "mac_test",
            inputEnabled: true,
            screenEnabled: true
          }),
          headers: { ...auth, "content-type": "application/json" },
          method: "POST"
        })
      ).resolves.toMatchObject({
        session: {
          id: "remote_test",
          hostMachineId: "mac_test",
          clientMachineId: "phone_test"
        }
      });

      await expect(
        fetchJson(`${endpoint}/api/remote-control/sessions/remote_test`, {
          headers: auth
        })
      ).resolves.toMatchObject({
        session: {
          id: "remote_test",
          status: "active"
        }
      });

      await expect(
        fetchJson(`${endpoint}/api/remote-control/sessions/remote_test/frame?afterSequence=0`, {
          headers: auth
        })
      ).resolves.toMatchObject({
        frame: {
          sequence: 1,
          dataBase64: "ZnJhbWU="
        }
      });

      await expect(
        fetchJson(`${endpoint}/api/remote-control/sessions/remote_test/input`, {
          body: JSON.stringify({
            event: {
              type: "text",
              value: "hello"
            }
          }),
          headers: { ...auth, "content-type": "application/json" },
          method: "POST"
        })
      ).resolves.toEqual({
        ok: true,
        session: expect.objectContaining({
          id: "remote_test"
        })
      });
      expect(remoteControl.inputEvents).toEqual([{ type: "text", value: "hello" }]);

      await expect(
        fetchJson(`${endpoint}/api/remote-control/sessions/remote_test/text-target`, {
          headers: auth
        })
      ).resolves.toEqual({
        target: {
          appName: "Notes",
          isTextInput: true,
          role: "AXTextArea",
          roleDescription: "text area"
        }
      });

      await expect(
        fetchJson(`${endpoint}/api/remote-control/sessions/remote_test/signals`, {
          headers: auth
        })
      ).resolves.toEqual({
        signals: []
      });

      await expect(
        fetchJson(`${endpoint}/api/remote-control/sessions/remote_test/signals`, {
          body: JSON.stringify({
            payload: {
              ignored: true
            },
            type: "status"
          }),
          headers: { ...auth, "content-type": "application/json" },
          method: "POST"
        })
      ).resolves.toMatchObject({
        signal: {
          type: "status"
        }
      });

      await expect(
        fetchJson(`${endpoint}/api/remote-control/sessions/remote_test`, {
          headers: auth,
          method: "DELETE"
        })
      ).resolves.toMatchObject({
        session: {
          status: "ended"
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function createFakeCodexBridge(options: { continueError?: Error } = {}): LocalCodexBridge & {
  listMessageRequests: Array<{
    conversationId: string;
    options?: { afterSequence?: number; forceRefresh?: boolean; includeRuntime?: boolean };
  }>;
  startedPrompts: string[];
  deletedQueuedTurns: Array<{ clientMessageId: string; conversationId: string }>;
  updatedQueuedTurns: Array<{ clientMessageId: string; conversationId: string; prompt: string }>;
} {
  const listMessageRequests: Array<{
    conversationId: string;
    options?: { afterSequence?: number; forceRefresh?: boolean; includeRuntime?: boolean };
  }> = [];
  const startedPrompts: string[] = [];
  const deletedQueuedTurns: Array<{ clientMessageId: string; conversationId: string }> = [];
  const updatedQueuedTurns: Array<{
    clientMessageId: string;
    conversationId: string;
    prompt: string;
  }> = [];

  return {
    deletedQueuedTurns,
    listMessageRequests,
    startedPrompts,
    updatedQueuedTurns,
    async bootstrap() {
      return { available: true };
    },
    async continueConversation(conversationId, input) {
      if (options.continueError) {
        throw options.continueError;
      }
      startedPrompts.push(input.prompt);
      return { conversationId, status: "running" };
    },
    async deleteQueuedTurn(conversationId, input) {
      deletedQueuedTurns.push({ clientMessageId: input.clientMessageId, conversationId });
      return { conversationId, removed: true, status: "queued" };
    },
    async updateQueuedTurn(conversationId, input) {
      updatedQueuedTurns.push({
        clientMessageId: input.clientMessageId,
        conversationId,
        prompt: input.prompt
      });
      return { conversationId, status: "queued", updated: true };
    },
    async listCompletionStates() {
      return [];
    },
    async listMessages(conversationId, listOptions) {
      listMessageRequests.push({ conversationId, options: listOptions });
      return [
        {
          content: "Hello from phone",
          conversationId,
          createdAt: "2026-05-09T12:00:00.000Z",
          id: `${conversationId}_message_1`,
          metadata: {},
          role: "user",
          sequence: 1,
          sourceDeviceId: "phone_test"
        }
      ];
    },
    async listGeneratedFiles() {
      return [
        {
          id: "file_demo",
          mimeType: "text/markdown",
          name: "summary.md",
          path: "/Users/reece/Desktop/Demo/summary.md",
          size: 12
        }
      ];
    },
    async downloadGeneratedFile(_conversationId, fileId) {
      if (fileId !== "file_demo") {
        throw Object.assign(new Error("Generated file not found"), { statusCode: 404 });
      }

      return {
        dataBase64: Buffer.from("hello file").toString("base64"),
        id: "file_demo",
        mimeType: "text/markdown",
        name: "summary.md",
        path: "/Users/reece/Desktop/Demo/summary.md",
        size: 12
      };
    },
    async listModelOptions() {
      return [];
    },
    async listProjectConversations() {
      return [];
    },
    async listProjects() {
      return [
        {
          conversationCount: 1,
          createdByUserId: "local",
          hostLocalPath: "/Users/reece/Desktop/Demo",
          id: "codex_project_demo",
          name: "Demo",
          repoSyncStatus: "codex_app",
          repoUrl: "/Users/reece/Desktop/Demo",
          source: "codex_app",
          updatedAt: "2026-05-09T12:00:00.000Z",
          workspaceId: "local"
        }
      ];
    },
    async startConversation(_projectId, input) {
      startedPrompts.push(input.prompt);
      return { conversationId: "codex_thread_new", status: "running" };
    }
  };
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

function createMemoryDiagnostics() {
  const events: Array<Record<string, unknown>> = [];
  const logger: MobileControlDiagnosticsLogger & {
    events: Array<Record<string, unknown>>;
    logPath?: string;
  } = {
    events,
    log(level, event, fields = {}) {
      events.push({ event, level, ...fields });
    }
  };

  return logger;
}

function createFakeRemoteControlManager(): LocalRemoteControlManager & {
  inputEvents: unknown[];
} {
  const session = {
    clientMachineId: "phone_test",
    createdAt: "2026-05-18T09:00:00.000Z",
    errorMessage: null,
    hostMachineId: "mac_test",
    id: "remote_test",
    inputEnabled: true,
    permissionState: {
      accessibility: "unknown" as const,
      screenRecording: "granted" as const
    },
    screenEnabled: true,
    status: "active" as const,
    updatedAt: "2026-05-18T09:00:01.000Z"
  };
  const inputEvents: unknown[] = [];

  return {
    inputEvents,
    async applyInput(_sessionId, _clientMachineId, event) {
      inputEvents.push(event);
      return session;
    },
    async captureNextFrameForTest() {},
    async endSession() {
      return { ...session, status: "ended" as const };
    },
    getLatestFrame() {
      return {
        frame: {
          capturedAt: "2026-05-18T09:00:01.000Z",
          dataBase64: "ZnJhbWU=",
          height: 720,
          mimeType: "image/jpeg",
          sequence: 1,
          width: 1170
        },
        session
      };
    },
    getSession() {
      return session;
    },
    async getTextInputTarget() {
      return {
        appName: "Notes",
        isTextInput: true,
        role: "AXTextArea",
        roleDescription: "text area"
      };
    },
    listSessions() {
      return [session];
    },
    async startSession() {
      return session;
    },
    async stopAll() {}
  };
}

function tokenUsageBucket(
  totalTokens: number,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number
) {
  return {
    cachedInputTokens,
    inputTokens,
    outputTokens,
    totalTokens
  };
}
