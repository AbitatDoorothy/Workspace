import { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalCodexBridge } from "../src/local-control/codex-bridge";

const openServers: WebSocketServer[] = [];
const cwd = "/Users/reece/Desktop/Abitat_Workspace";

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map((server) => {
      for (const client of server.clients) {
        client.terminate();
      }

      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    })
  );
});

describe("local Codex bridge command queue and steer", () => {
  it("queues phone commands while a Codex turn is running and starts them when idle", async () => {
    let isRunning = true;
    const turnStarts: Array<Record<string, unknown>> = [];
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: createThread({
            status: isRunning ? { activeFlags: [], type: "active" } : { type: "idle" },
            turns: [
              createTurn({
                completedAt: isRunning ? null : 1_778_000_050,
                id: "turn_current",
                status: isRunning ? "inProgress" : "completed"
              })
            ]
          })
        });
      }

      if (message.method === "thread/resume") {
        sendResult(socket, message.id, {
          thread: createThread({
            status: { activeFlags: [], type: "active" },
            turns: [
              createTurn({
                completedAt: 1_778_000_050,
                id: "turn_current",
                status: "completed"
              })
            ]
          })
        });
      }

      if (message.method === "turn/start") {
        turnStarts.push(message.params as Record<string, unknown>);
        sendResult(socket, message.id, {
          turn: createTurn({
            completedAt: null,
            id: "turn_queued",
            status: "inProgress"
          })
        });
        setImmediate(() => {
          socket.send(
            JSON.stringify({
              method: "turn/completed",
              params: { threadId: "thread_busy", turnId: "turn_queued" }
            })
          );
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    await expect(
      bridge.continueConversation("codex_thread_thread_busy", {
        prompt: "Run this after the desktop task"
      })
    ).resolves.toEqual({
      conversationId: "codex_thread_thread_busy",
      status: "queued"
    });

    expect(turnStarts).toEqual([]);
    isRunning = false;
    await waitFor(() => turnStarts.length === 1);
    expect(turnStarts[0]).toMatchObject({
      input: [{ text: "Run this after the desktop task", text_elements: [], type: "text" }],
      threadId: "thread_busy"
    });
  });

  it("steers active Codex turns by interrupting the current turn and starting a replacement", async () => {
    let injectParams: Record<string, unknown> | null = null;
    let steerParams: Record<string, unknown> | null = null;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: createThread({
            turns: [
              createTurn({
                completedAt: null,
                id: "turn_current",
                status: "inProgress"
              })
            ]
          })
        });
      }

      if (message.method === "thread/inject_items") {
        injectParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, {});
      }

      if (message.method === "turn/steer") {
        steerParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, { turnId: "turn_steered" });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    await expect(
      bridge.continueConversation("codex_thread_thread_busy", {
        delivery: "steer",
        prompt: "Change direction now"
      })
    ).resolves.toEqual({
      conversationId: "codex_thread_thread_busy",
      status: "running"
    });

    expect(injectParams).toBeNull();
    expect(steerParams).toEqual({
      expectedTurnId: "turn_current",
      input: [{ text: "Change direction now", text_elements: [], type: "text" }],
      threadId: "thread_busy"
    });
  });

  it("steers in-progress desktop turns even when the thread status summary is stale", async () => {
    let startParams: Record<string, unknown> | null = null;
    let steerParams: Record<string, unknown> | null = null;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: createThread({
            status: { type: "idle" },
            turns: [
              createTurn({
                completedAt: null,
                id: "turn_desktop_current",
                status: "inProgress"
              })
            ]
          })
        });
      }

      if (message.method === "thread/resume") {
        sendResult(socket, message.id, {
          thread: createThread({
            status: { type: "active" },
            turns: [
              createTurn({
                completedAt: null,
                id: "turn_desktop_current",
                status: "inProgress"
              })
            ]
          })
        });
      }

      if (message.method === "turn/start") {
        startParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, {
          turn: createTurn({
            completedAt: null,
            id: "turn_started_wrongly",
            status: "inProgress"
          })
        });
      }

      if (message.method === "turn/steer") {
        steerParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, { turnId: "turn_steered" });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    await expect(
      bridge.continueConversation("codex_thread_thread_busy", {
        delivery: "steer",
        prompt: "stop"
      })
    ).resolves.toEqual({
      conversationId: "codex_thread_thread_busy",
      status: "running"
    });

    expect(startParams).toBeNull();
    expect(steerParams).toEqual({
      expectedTurnId: "turn_desktop_current",
      input: [{ text: "stop", text_elements: [], type: "text" }],
      threadId: "thread_busy"
    });
  });
});

async function waitFor(predicate: () => boolean) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3_000) {
    if (predicate()) {
      return;
    }
    await delay(25);
  }
  throw new Error("Timed out waiting for condition");
}

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

function createThread(
  input: {
    status?: unknown;
    turns?: unknown[];
  } = {}
) {
  return {
    createdAt: 1_778_000_000,
    cwd,
    ephemeral: false,
    id: "thread_busy",
    name: null,
    preview: "Busy thread",
    status: input.status ?? { activeFlags: [], type: "active" },
    turns: input.turns ?? [createTurn({ status: "inProgress" })],
    updatedAt: 1_778_000_010
  };
}

function createTurn(input: { completedAt?: number | null; id?: string; status?: unknown } = {}) {
  return {
    completedAt: input.completedAt ?? null,
    error: null,
    id: input.id ?? "turn_current",
    items: [],
    startedAt: 1_778_000_000,
    status: input.status ?? "inProgress"
  };
}
