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
      desktopRefresh: false,
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
    const closed = new Promise<void>((resolve) => {
      resolveClosed = () => {
        closeResolved = true;
        resolve();
      };
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread-follower-start-turn") {
        sendError(socket, message.id, "thread-follower-start-turn-timeout");
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
      desktopRefresh: false,
      serverUrl
    });

    await client.startTurn("thread_1", [{ text: "hello", text_elements: [], type: "text" }]);
    await delay(50);

    expect(closeResolved).toBe(false);
    if (!activeSocket) {
      throw new Error("Expected the mock server to receive a Codex app websocket connection");
    }

    expect(activeSocket.readyState).toBe(WebSocket.OPEN);

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

  it("starts turns through the desktop owner when the Codex window owns the thread", async () => {
    const methods: string[] = [];
    let followerParams: Record<string, unknown> | null = null;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method) {
        methods.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread-follower-start-turn") {
        followerParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, {
          result: {
            turn: {
              completedAt: null,
              durationMs: null,
              error: null,
              id: "turn_owner",
              items: [],
              startedAt: 1_778_000_000,
              status: "inProgress"
            }
          }
        });
      }

      if (message.method === "turn/start") {
        sendResult(socket, message.id, {
          turn: {
            completedAt: null,
            durationMs: null,
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
      desktopRefresh: false,
      serverUrl
    });

    const response = await client.startTurn(
      "thread_1",
      [{ text: "hello from phone", text_elements: [], type: "text" }],
      {
        cwd: "/Users/reece/Desktop/Abitat_Workspace"
      }
    );

    expect(response.turn.id).toBe("turn_owner");
    expect(methods).toContain("thread-follower-start-turn");
    expect(methods).not.toContain("turn/start");
    expect(followerParams).toEqual({
      conversationId: "thread_1",
      turnStartParams: {
        cwd: "/Users/reece/Desktop/Abitat_Workspace",
        input: [{ text: "hello from phone", text_elements: [], type: "text" }],
        threadId: "thread_1"
      }
    });
  });

  it("falls back to raw app-server turns when there is no desktop owner", async () => {
    const methods: string[] = [];
    let rawTurnParams: Record<string, unknown> | null = null;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method) {
        methods.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread-follower-start-turn") {
        sendError(socket, message.id, "thread-follower-start-turn-timeout");
      }

      if (message.method === "turn/start") {
        rawTurnParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, {
          turn: {
            completedAt: null,
            durationMs: null,
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
      desktopRefresh: false,
      serverUrl
    });

    const response = await client.startTurn(
      "thread_1",
      [{ text: "hello from phone", text_elements: [], type: "text" }],
      {
        cwd: "/Users/reece/Desktop/Abitat_Workspace"
      }
    );

    expect(response.turn.id).toBe("turn_raw");
    expect(rawTurnParams).toEqual({
      cwd: "/Users/reece/Desktop/Abitat_Workspace",
      input: [{ text: "hello from phone", text_elements: [], type: "text" }],
      threadId: "thread_1"
    });
    expect(methods).toEqual([
      "initialize",
      "initialized",
      "thread-follower-start-turn",
      "initialize",
      "initialized",
      "turn/start"
    ]);
  });

  it("refreshes the Codex desktop thread after an immediately completed raw turn", async () => {
    const refreshes: Array<{ cwd?: string | null; threadId: string }> = [];
    let resolveClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread-follower-start-turn") {
        sendError(socket, message.id, "thread-follower-start-turn-timeout");
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

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: {
            turns: [
              {
                id: "turn_completed",
                items: [{ id: "item_agent", text: "done", type: "agentMessage" }],
                status: "completed"
              }
            ]
          }
        });
      }
    });
    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      desktopRefresh: (threadId: string, options?: { cwd?: string | null }) => {
        refreshes.push({ cwd: options?.cwd, threadId });
      },
      serverUrl
    });

    await client.startTurn("thread_1", [{ text: "hello", text_elements: [], type: "text" }], {
      cwd: "/Users/reece/Desktop/Abitat_Workspace"
    });
    await closed;

    expect(refreshes).toEqual([
      { cwd: "/Users/reece/Desktop/Abitat_Workspace", threadId: "thread_1" }
    ]);
  });

  it("falls back when the public Codex app-server rejects the desktop-owner method", async () => {
    const methods: string[] = [];
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method) {
        methods.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread-follower-start-turn") {
        sendError(
          socket,
          message.id,
          "Invalid request: unknown variant `thread-follower-start-turn`"
        );
      }

      if (message.method === "turn/start") {
        sendResult(socket, message.id, {
          turn: {
            completedAt: null,
            durationMs: null,
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
      desktopRefresh: false,
      serverUrl
    });

    const response = await client.startTurn("thread_1", [
      { text: "hello from phone", text_elements: [], type: "text" }
    ]);

    expect(response.turn.id).toBe("turn_raw");
    expect(methods).toEqual([
      "initialize",
      "initialized",
      "thread-follower-start-turn",
      "initialize",
      "initialized",
      "turn/start"
    ]);
  });

  it("refreshes the Codex desktop thread after a started turn completes", async () => {
    let activeSocket: WebSocket | undefined;
    const methods: string[] = [];
    const refreshes: Array<{ cwd?: string | null; threadId: string }> = [];
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

      if (message.method === "thread-follower-start-turn") {
        sendError(socket, message.id, "thread-follower-start-turn-timeout");
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

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: {
            turns: [
              {
                id: "turn_1",
                items: [{ id: "item_agent", text: "done", type: "agentMessage" }],
                status: "completed"
              }
            ]
          }
        });
      }
    });
    const client = createCodexAppClient({
      codexBinaryPath: "/unused",
      desktopRefresh: (threadId: string, options?: { cwd?: string | null }) => {
        refreshes.push({ cwd: options?.cwd, threadId });
      },
      serverUrl
    });

    await client.startTurn("thread_1", [{ text: "hello", text_elements: [], type: "text" }], {
      cwd: "/Users/reece/Desktop/Abitat_Workspace"
    });
    await delay(50);

    expect(refreshes).toEqual([]);
    if (!activeSocket) {
      throw new Error("Expected the mock server to receive a Codex app websocket connection");
    }

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

    expect(refreshes).toEqual([
      { cwd: "/Users/reece/Desktop/Abitat_Workspace", threadId: "thread_1" }
    ]);
    expect(methods).toContain("thread/read");
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

function sendError(socket: WebSocket, id: number | undefined, message: string) {
  socket.send(JSON.stringify({ error: { message }, id }));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
