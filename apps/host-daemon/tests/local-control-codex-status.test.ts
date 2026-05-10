import { AddressInfo } from "node:net";

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

describe("local Codex mobile status sync", () => {
  it("keeps an active desktop thread running even when the latest persisted turn is stale interrupted", async () => {
    const activeThread = createThread({
      status: { activeFlags: [], type: "active" },
      turns: [
        createTurn({
          completedAt: 1_778_000_050,
          id: "turn_stale_interrupted",
          status: "interrupted"
        })
      ]
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [activeThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread: activeThread });
      }
    });
    const bridge = createLocalCodexBridge({
      codexBinaryPath: "/unused",
      serverUrl,
      workspaceId: "workspace_demo"
    });

    const [project] = await bridge.listProjects();
    const [conversation] = await bridge.listProjectConversations(project.id);
    const [completion] = await bridge.listCompletionStates();

    expect(conversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_active",
        status: "running"
      })
    );
    expect(completion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_active",
        failed: false,
        isComplete: false,
        latestTurnId: "turn_stale_interrupted",
        status: "running"
      })
    );
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

function createThread(input: { status?: unknown; turns?: unknown[] } = {}) {
  return {
    createdAt: 1_778_000_000,
    cwd,
    ephemeral: false,
    id: "thread_active",
    name: null,
    preview: "Desktop running thread",
    status: input.status ?? { activeFlags: [], type: "active" },
    turns: input.turns ?? [],
    updatedAt: 1_778_000_060
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
