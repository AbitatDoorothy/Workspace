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

  it("deletes queued phone commands before they drain into Codex", async () => {
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

      if (message.method === "turn/start") {
        turnStarts.push(message.params as Record<string, unknown>);
        sendResult(socket, message.id, {
          turn: createTurn({
            completedAt: null,
            id: "turn_deleted_wrongly",
            status: "inProgress"
          })
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    await bridge.continueConversation("codex_thread_thread_busy", {
      clientMessageId: "ios-queued-delete",
      prompt: "Delete me before I run"
    });

    await expect(
      bridge.deleteQueuedTurn("codex_thread_thread_busy", {
        clientMessageId: "ios-queued-delete"
      })
    ).resolves.toEqual({
      conversationId: "codex_thread_thread_busy",
      removed: true,
      status: "running"
    });

    isRunning = false;
    await delay(450);
    expect(turnStarts).toEqual([]);
  });

  it("updates queued phone commands before they drain into Codex", async () => {
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
            id: "turn_edited",
            status: "inProgress"
          })
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    await bridge.continueConversation("codex_thread_thread_busy", {
      clientMessageId: "ios-queued-edit",
      prompt: "Original queued prompt"
    });

    await expect(
      bridge.updateQueuedTurn("codex_thread_thread_busy", {
        clientMessageId: "ios-queued-edit",
        prompt: "Edited queued prompt"
      })
    ).resolves.toEqual({
      conversationId: "codex_thread_thread_busy",
      status: "queued",
      updated: true
    });

    isRunning = false;
    await waitFor(() => turnStarts.length === 1);
    expect(turnStarts[0]).toMatchObject({
      input: [{ text: "Edited queued prompt", text_elements: [], type: "text" }],
      threadId: "thread_busy"
    });
  });

  it("does not duplicate queued phone commands when the phone retries the same client message", async () => {
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
            id: `turn_retry_${turnStarts.length}`,
            status: "inProgress"
          })
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    await bridge.continueConversation("codex_thread_thread_busy", {
      clientMessageId: "ios-retry-queued",
      prompt: "Retry this once idle"
    });
    await bridge.continueConversation("codex_thread_thread_busy", {
      clientMessageId: "ios-retry-queued",
      prompt: "Retry this once idle"
    });

    isRunning = false;
    await waitFor(() => turnStarts.length === 1);
    await delay(450);
    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]).toMatchObject({
      input: [{ text: "Retry this once idle", text_elements: [], type: "text" }],
      threadId: "thread_busy"
    });
  });

  it("starts phone commands when only an older stale turn is still marked in progress", async () => {
    let startParams: Record<string, unknown> | null = null;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/read" || message.method === "thread/resume") {
        sendResult(socket, message.id, {
          thread: createThread({
            status: { type: "idle" },
            turns: [
              createTurn({
                completedAt: null,
                id: "turn_stale_in_progress",
                status: "inProgress"
              }),
              createTurn({
                completedAt: 1_778_000_080,
                id: "turn_latest_completed",
                status: "completed"
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
            id: "turn_started_after_stale",
            status: "inProgress"
          })
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    await expect(
      bridge.continueConversation("codex_thread_thread_busy", {
        clientMessageId: "ios-after-stale-turn",
        prompt: "This should start immediately"
      })
    ).resolves.toEqual({
      conversationId: "codex_thread_thread_busy",
      status: "running"
    });

    expect(startParams).toMatchObject({
      input: [{ text: "This should start immediately", text_elements: [], type: "text" }],
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

  it("removes a queued command when that same command is steered immediately", async () => {
    let startParams: Record<string, unknown> | null = null;
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

    await bridge.continueConversation("codex_thread_thread_busy", {
      clientMessageId: "ios-queued-steer",
      prompt: "Normal queue"
    });
    await bridge.continueConversation("codex_thread_thread_busy", {
      clientMessageId: "ios-queued-steer",
      delivery: "steer",
      prompt: "Steer now"
    });

    await delay(450);
    expect(startParams).toBeNull();
    expect(steerParams).toEqual({
      expectedTurnId: "turn_current",
      input: [{ text: "Steer now", text_elements: [], type: "text" }],
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
      const message = JSON.parse(raw.toString());
      if (message.method === "thread/loaded/list") {
        sendResult(socket, message.id, { data: [], nextCursor: null });
        return;
      }

      onMessage(socket, message);
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
