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
  it("hydrates stale active no-turn summaries before reporting mobile conversation status", async () => {
    const listThread = createThread({
      status: { activeFlags: [], type: "active" },
      turns: [],
      updatedAt: 1_778_000_060
    });
    const completedReadThread = createThread({
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_070,
          id: "turn_completed",
          status: "completed"
        })
      ],
      updatedAt: 1_778_000_070
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [listThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread: completedReadThread });
      }
    });
    const bridge = createBridge(serverUrl);

    const [project] = await bridge.listProjects();
    const [conversation] = await bridge.listProjectConversations(project.id);

    expect(conversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_active",
        status: "approved"
      })
    );
  });

  it("prefers live active thread status over stale state DB and read snapshots", async () => {
    const staleThread = createThread({
      status: { type: "notLoaded" },
      turns: [
        createTurn({
          completedAt: null,
          id: "turn_stale_interrupted",
          status: "interrupted"
        })
      ],
      updatedAt: 1_778_000_060
    });
    const liveThread = createThread({
      status: { activeFlags: [], type: "active" },
      turns: [],
      updatedAt: 1_778_000_065
    });
    const { serverUrl } = await startMockCodexAppServer(
      (socket, message) => {
        const params = message.params as { includeTurns?: boolean; useStateDbOnly?: boolean };
        if (message.method === "thread/list") {
          sendResult(socket, message.id, {
            data: [params.useStateDbOnly === false ? liveThread : staleThread],
            nextCursor: null
          });
        }

        if (message.method === "thread/read") {
          sendResult(socket, message.id, {
            thread: params.includeTurns === false ? liveThread : staleThread
          });
        }
      },
      { loadedThreadIds: [liveThread.id] }
    );
    const bridge = createBridge(serverUrl);

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

  it("treats newer thread-list activity than stale read turns as desktop-running work", async () => {
    const staleReadThread = createThread({
      status: { type: "notLoaded" },
      turns: [
        createTurn({
          completedAt: null,
          id: "turn_stale_interrupted",
          startedAt: 1_778_000_000,
          status: "interrupted"
        })
      ],
      updatedAt: 1_778_000_060
    });
    const newerListThread = createThread({
      status: { type: "notLoaded" },
      turns: [],
      updatedAt: 1_778_000_120
    });
    const { serverUrl } = await startMockCodexAppServer(
      (socket, message) => {
        const params = message.params as { includeTurns?: boolean };
        if (message.method === "thread/list") {
          sendResult(socket, message.id, { data: [newerListThread], nextCursor: null });
        }

        if (message.method === "thread/read") {
          sendResult(socket, message.id, {
            thread: params.includeTurns === false ? newerListThread : staleReadThread
          });
        }
      },
      { loadedThreadIds: [newerListThread.id] }
    );
    const bridge = createBridge(serverUrl);

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

  it("treats newer idle thread-list activity than stale read turns as desktop-running work", async () => {
    const staleReadThread = createThread({
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: null,
          id: "turn_stale_interrupted",
          startedAt: 1_778_000_000,
          status: "interrupted"
        })
      ],
      updatedAt: 1_778_000_060
    });
    const newerListThread = createThread({
      status: { type: "idle" },
      turns: [],
      updatedAt: 1_778_000_120
    });
    const { serverUrl } = await startMockCodexAppServer(
      (socket, message) => {
        const params = message.params as { includeTurns?: boolean };
        if (message.method === "thread/list") {
          sendResult(socket, message.id, { data: [newerListThread], nextCursor: null });
        }

        if (message.method === "thread/read") {
          sendResult(socket, message.id, {
            thread: params.includeTurns === false ? newerListThread : staleReadThread
          });
        }
      },
      { loadedThreadIds: [newerListThread.id] }
    );
    const bridge = createBridge(serverUrl);

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

  it("treats the first desktop activity snapshot as running when activity matches the interrupted turn start", async () => {
    const staleReadThread = createThread({
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: null,
          id: "turn_stale_interrupted",
          startedAt: 1_778_000_120,
          status: "interrupted"
        })
      ],
      updatedAt: 1_778_000_060
    });
    const firstListThread = createThread({
      status: { type: "idle" },
      turns: [],
      updatedAt: 1_778_000_120
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      const params = message.params as { includeTurns?: boolean };
      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [firstListThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: params.includeTurns === false ? firstListThread : staleReadThread
        });
      }
    });
    const bridge = createBridge(serverUrl);

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

  it("keeps unloaded interrupted no-turn snapshots cancelled", async () => {
    const staleReadThread = createThread({
      id: "thread_unloaded_interrupted",
      preview: "Unloaded interrupted thread",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: null,
          id: "turn_interrupted",
          startedAt: 1_778_000_120,
          status: "interrupted"
        })
      ],
      updatedAt: 1_778_000_060
    });
    const listThread = createThread({
      id: "thread_unloaded_interrupted",
      preview: "Unloaded interrupted thread",
      status: { type: "idle" },
      turns: [],
      updatedAt: 1_778_000_100
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [listThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread: staleReadThread });
      }
    });
    const bridge = createBridge(serverUrl);

    const [project] = await bridge.listProjects();
    const [conversation] = await bridge.listProjectConversations(project.id);
    const [completion] = await bridge.listCompletionStates();

    expect(conversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_unloaded_interrupted",
        status: "cancelled"
      })
    );
    expect(completion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_unloaded_interrupted",
        failed: true,
        isComplete: true,
        latestTurnId: "turn_interrupted",
        status: "cancelled"
      })
    );
  });

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
      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [activeThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread: activeThread });
      }
    });
    const bridge = createBridge(serverUrl);

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

  it("keeps genuinely completed inactive Codex threads approved", async () => {
    const completedThread = createThread({
      id: "thread_completed",
      preview: "Completed thread",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_050,
          id: "turn_completed",
          status: "completed"
        })
      ]
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [completedThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread: completedThread });
      }
    });
    const bridge = createBridge(serverUrl);

    const [project] = await bridge.listProjects();
    const [conversation] = await bridge.listProjectConversations(project.id);
    const [completion] = await bridge.listCompletionStates();

    expect(conversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_completed",
        status: "approved"
      })
    );
    expect(completion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_completed",
        failed: false,
        isComplete: true,
        latestTurnId: "turn_completed",
        status: "approved"
      })
    );
  });

  it("keeps genuinely interrupted inactive Codex threads cancelled", async () => {
    const interruptedThread = createThread({
      id: "thread_interrupted",
      preview: "Interrupted thread",
      status: { type: "notLoaded" },
      turns: [
        createTurn({
          completedAt: null,
          id: "turn_interrupted",
          status: "interrupted"
        })
      ]
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [interruptedThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread: interruptedThread });
      }
    });
    const bridge = createBridge(serverUrl);

    const [project] = await bridge.listProjects();
    const [conversation] = await bridge.listProjectConversations(project.id);
    const [completion] = await bridge.listCompletionStates();

    expect(conversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_interrupted",
        status: "cancelled"
      })
    );
    expect(completion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_interrupted",
        failed: true,
        isComplete: true,
        latestTurnId: "turn_interrupted",
        status: "cancelled"
      })
    );
  });
});

function createBridge(serverUrl: string) {
  return createLocalCodexBridge({
    codexBinaryPath: "/unused",
    serverUrl,
    workspaceId: "workspace_demo"
  });
}

async function startMockCodexAppServer(
  onMessage: (
    socket: WebSocket,
    message: { id?: number; method?: string; params?: unknown }
  ) => void,
  options: { loadedThreadIds?: string[] } = {}
) {
  const server = new WebSocketServer({ port: 0 });
  openServers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));

  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
        return;
      }

      if (message.method === "thread/loaded/list") {
        sendResult(socket, message.id, { data: options.loadedThreadIds ?? [], nextCursor: null });
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
    id?: string;
    preview?: string;
    status?: unknown;
    turns?: unknown[];
    updatedAt?: number;
  } = {}
) {
  return {
    createdAt: 1_778_000_000,
    cwd,
    ephemeral: false,
    id: input.id ?? "thread_active",
    name: null,
    preview: input.preview ?? "Desktop running thread",
    status: input.status ?? { activeFlags: [], type: "active" },
    turns: input.turns ?? [],
    updatedAt: input.updatedAt ?? 1_778_000_060
  };
}

function createTurn(
  input: {
    completedAt?: number | null;
    id?: string;
    startedAt?: number | null;
    status?: unknown;
  } = {}
) {
  return {
    completedAt: input.completedAt ?? null,
    error: null,
    id: input.id ?? "turn_current",
    items: [],
    startedAt: input.startedAt ?? 1_778_000_000,
    status: input.status ?? "inProgress"
  };
}
