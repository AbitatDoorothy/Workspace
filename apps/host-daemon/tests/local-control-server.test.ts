import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { MobileControlDiagnosticsLogger } from "../src/local-control/diagnostics-log";
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
        fetchJson(`${endpoint}/api/mobile/conversations/codex_thread_new/messages`, {
          headers: auth
        })
      ).resolves.toEqual({
        messages: [
          expect.objectContaining({
            content: "Hello from phone",
            role: "user"
          })
        ]
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
});

function createFakeCodexBridge(options: { continueError?: Error } = {}): LocalCodexBridge & {
  startedPrompts: string[];
} {
  const startedPrompts: string[] = [];

  return {
    startedPrompts,
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
    async listCompletionStates() {
      return [];
    },
    async listMessages(conversationId) {
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
  const logger: MobileControlDiagnosticsLogger & { events: Array<Record<string, unknown>> } = {
    events,
    log(level, event, fields = {}) {
      events.push({ event, level, ...fields });
    }
  };

  return logger;
}
