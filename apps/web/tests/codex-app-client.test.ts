import { AddressInfo } from "node:net";

import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createCodexAppClient } from "../server/codex-app/codex-app-client";

const openServers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("Codex app client", () => {
  it("declares the experimental API capability during initialization", async () => {
    let initializeParams: Record<string, unknown> | null = null;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        initializeParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/list") {
        sendResult(socket, message.id, {
          backwardsCursor: null,
          data: [],
          nextCursor: null
        });
      }
    });

    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      serverUrl
    });

    await client.listThreads();

    expect(initializeParams).toEqual(
      expect.objectContaining({
        capabilities: expect.objectContaining({
          experimentalApi: true
        })
      })
    );
  });

  it("keeps the websocket alive until a started turn completes", async () => {
    let activeSocket: WebSocket | undefined;
    let closeResolved = false;
    let resolveClosed: () => void = () => undefined;
    const methods: string[] = [];
    const closed = new Promise<void>((resolve) => {
      resolveClosed = () => {
        closeResolved = true;
        resolve();
      };
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method) {
        methods.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "turn/start") {
        activeSocket = socket;
        socket.once("close", resolveClosed);
        sendResult(socket, message.id, {
          turn: {
            completedAt: null,
            durationMs: null,
            error: null,
            id: "turn_1",
            items: [],
            startedAt: 1_778_000_000,
            status: "inProgress"
          }
        });
      }
    });
    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      serverUrl
    });

    await client.startTurn("thread_1", [{ text: "hello", text_elements: [], type: "text" }]);
    await delay(50);

    expect(closeResolved).toBe(false);
    if (!activeSocket) {
      throw new Error("Expected the mock server to receive a Codex app websocket connection");
    }

    expect(activeSocket.readyState).toBe(WebSocket.OPEN);
    expect(methods).toEqual(["initialize", "initialized", "turn/start"]);

    activeSocket.send(
      JSON.stringify({
        method: "turn/completed",
        params: {
          threadId: "thread_1",
          turnId: "turn_1"
        }
      })
    );
    await closed;
  });

  it("starts phone turns through the raw app-server protocol only", async () => {
    const methods: string[] = [];
    let rawTurnParams: Record<string, unknown> | null = null;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method) {
        methods.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "turn/start") {
        rawTurnParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, {
          turn: {
            completedAt: 1_778_000_001,
            durationMs: 1000,
            error: null,
            id: "turn_raw",
            items: [],
            startedAt: 1_778_000_000,
            status: "completed"
          }
        });
      }
    });
    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      serverUrl
    });

    const response = await client.startTurn(
      "thread_1",
      [{ text: "hello from phone", text_elements: [], type: "text" }],
      {
        approvalPolicy: "never",
        effort: "high",
        model: "gpt-5.3-codex",
        sandboxPolicy: { type: "dangerFullAccess" },
        cwd: "/Users/reece/Desktop/Abitat_Workspace"
      }
    );

    expect(response.turn.id).toBe("turn_raw");
    expect(rawTurnParams).toEqual({
      approvalPolicy: "never",
      cwd: "/Users/reece/Desktop/Abitat_Workspace",
      effort: "high",
      input: [{ text: "hello from phone", text_elements: [], type: "text" }],
      model: "gpt-5.3-codex",
      sandboxPolicy: { type: "dangerFullAccess" },
      threadId: "thread_1"
    });
    expect(methods).toEqual(["initialize", "initialized", "turn/start"]);
  });

  it("lists available Codex models through the app-server protocol", async () => {
    const modelListRequests: unknown[] = [];
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "model/list") {
        modelListRequests.push(message.params);
        sendResult(
          socket,
          message.id,
          modelListRequests.length === 1
            ? {
                data: [
                  {
                    defaultReasoningEffort: "medium",
                    description: "Best for agentic coding.",
                    displayName: "GPT-5.3 Codex",
                    hidden: false,
                    id: "gpt-5.3-codex",
                    isDefault: true,
                    model: "gpt-5.3-codex",
                    supportedReasoningEfforts: [
                      { description: "Minimal", reasoningEffort: "minimal" },
                      { description: "Medium", reasoningEffort: "medium" },
                      { description: "High", reasoningEffort: "high" }
                    ]
                  }
                ],
                nextCursor: "cursor_2"
              }
            : {
                data: [
                  {
                    defaultReasoningEffort: "low",
                    description: "Fast coding model.",
                    displayName: "GPT-5.4 Mini",
                    hidden: false,
                    id: "gpt-5.4-mini",
                    isDefault: false,
                    model: "gpt-5.4-mini",
                    supportedReasoningEfforts: [
                      { description: "Low", reasoningEffort: "low" },
                      { description: "Medium", reasoningEffort: "medium" }
                    ]
                  }
                ],
                nextCursor: null
              }
        );
      }
    });
    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      serverUrl
    });

    await expect(client.listModels()).resolves.toEqual([
      expect.objectContaining({
        defaultReasoningEffort: "medium",
        displayName: "GPT-5.3 Codex",
        id: "gpt-5.3-codex",
        supportedReasoningEfforts: ["minimal", "medium", "high"]
      }),
      expect.objectContaining({
        defaultReasoningEffort: "low",
        displayName: "GPT-5.4 Mini",
        id: "gpt-5.4-mini",
        supportedReasoningEfforts: ["low", "medium"]
      })
    ]);
    expect(modelListRequests).toEqual([
      { cursor: null, includeHidden: false, limit: 200 },
      { cursor: "cursor_2", includeHidden: false, limit: 200 }
    ]);
  });

  it("lists loaded app-server threads for stale-context detection", async () => {
    const loadedThreadRequests: unknown[] = [];
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/loaded/list") {
        loadedThreadRequests.push(message.params);
        sendResult(
          socket,
          message.id,
          loadedThreadRequests.length === 1
            ? { data: ["thread_a"], nextCursor: "cursor_2" }
            : { data: ["thread_b"], nextCursor: null }
        );
      }
    });
    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      serverUrl
    });

    await expect(client.listLoadedThreads()).resolves.toEqual(["thread_a", "thread_b"]);
    expect(loadedThreadRequests).toEqual([
      { cursor: null, limit: 200 },
      { cursor: "cursor_2", limit: 200 }
    ]);
  });

  it("injects model-visible items through the app-server protocol", async () => {
    const methods: string[] = [];
    let injectParams: Record<string, unknown> | null = null;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method) {
        methods.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/inject_items") {
        injectParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, {});
      }
    });
    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      serverUrl
    });

    await client.injectItems("thread_1", [
      {
        content: [{ text: "Bryan birthday is 9th of May", type: "input_text" }],
        role: "user",
        type: "message"
      }
    ]);

    expect(injectParams).toEqual({
      items: [
        {
          content: [{ text: "Bryan birthday is 9th of May", type: "input_text" }],
          role: "user",
          type: "message"
        }
      ],
      threadId: "thread_1"
    });
    expect(methods).toEqual(["initialize", "initialized", "thread/inject_items"]);
  });

  it("closes immediately completed phone turns without desktop refresh backfill", async () => {
    const methods: string[] = [];
    let resolveClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method) {
        methods.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "turn/start") {
        socket.once("close", resolveClosed);
        sendResult(socket, message.id, {
          turn: {
            completedAt: 1_778_000_005,
            durationMs: 5000,
            error: null,
            id: "turn_completed",
            items: [{ id: "item_agent", text: "done", type: "agentMessage" }],
            startedAt: 1_778_000_000,
            status: "completed"
          }
        });
      }
    });
    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      serverUrl
    });

    await client.startTurn("thread_1", [{ text: "hello", text_elements: [], type: "text" }], {
      cwd: "/Users/reece/Desktop/Abitat_Workspace"
    });
    await closed;

    expect(methods).toEqual(["initialize", "initialized", "turn/start"]);
  });

  it("tolerates the Codex app-server socket closing while a phone-started turn is running", async () => {
    let activeSocket: WebSocket | undefined;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "turn/start") {
        activeSocket = socket;
        sendResult(socket, message.id, {
          turn: {
            completedAt: null,
            durationMs: null,
            error: null,
            id: "turn_running",
            items: [],
            startedAt: 1_778_000_000,
            status: "inProgress"
          }
        });
      }
    });
    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      serverUrl
    });

    const response = await client.startTurn("thread_1", [
      { text: "from phone", text_elements: [], type: "text" }
    ]);

    expect(response.turn.id).toBe("turn_running");
    if (!activeSocket) {
      throw new Error("Expected the mock server to receive a Codex app websocket connection");
    }

    activeSocket.close();
    await delay(50);
  });
});

async function startMockCodexAppServer(
  onMessage: (
    socket: WebSocket,
    message: { id?: number; method?: string; params?: unknown }
  ) => void
) {
  const server = new WebSocketServer({ port: 0 });
  openServers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));

  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      onMessage(socket, JSON.parse(raw.toString()));
    });
  });

  const address = server.address() as AddressInfo;
  return { serverUrl: `ws://127.0.0.1:${address.port}` };
}

function sendResult(socket: WebSocket, id: number | undefined, result: unknown) {
  socket.send(JSON.stringify({ id, result }));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
