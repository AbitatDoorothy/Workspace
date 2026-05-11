import { AddressInfo } from "node:net";

import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalCodexBridge, flattenThreadMessages } from "../src/local-control/codex-bridge";
import type { MobileControlDiagnosticsLogger } from "../src/local-control/diagnostics-log";

const openServers: WebSocketServer[] = [];

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

describe("local Codex bridge diagnostics", () => {
  it("logs unknown thread item types and completed turns without visible assistant messages", () => {
    const diagnostics = createMemoryDiagnostics();
    const messages = flattenThreadMessages(
      {
        createdAt: 1_778_400_000,
        cwd: "/Users/reece/Desktop/Demo",
        ephemeral: false,
        id: "thread_demo",
        name: null,
        preview: "Demo",
        status: { type: "idle" },
        turns: [
          {
            completedAt: 1_778_400_010,
            error: null,
            id: "turn_1",
            items: [
              {
                content: [{ text: "Sensitive user prompt", text_elements: [], type: "text" }],
                id: "item_user",
                type: "userMessage"
              },
              {
                id: "item_reasoning",
                summary: ["hidden reasoning"],
                type: "reasoning"
              },
              {
                id: "item_unknown",
                value: "hidden payload",
                type: "newCodexThing"
              }
            ],
            startedAt: 1_778_400_000,
            status: { type: "completed" }
          }
        ],
        updatedAt: 1_778_400_010
      } as any,
      "codex_thread_thread_demo",
      diagnostics
    );

    expect(messages).toEqual([
      expect.objectContaining({
        content: "Sensitive user prompt",
        role: "user"
      })
    ]);
    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({
        codexItemType: "newCodexThing",
        event: "codex.thread_item.unknown",
        threadId: "thread_demo",
        turnId: "turn_1"
      })
    );
    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({
        assistant: 0,
        event: "codex.thread.messages_flattened",
        runtime: 0,
        user: 1,
        visible: 1
      })
    );
    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({
        event: "codex.turn.completed_without_visible_assistant",
        threadId: "thread_demo",
        turnId: "turn_1"
      })
    );
    expect(JSON.stringify(diagnostics.events)).not.toContain("Sensitive user prompt");
    expect(JSON.stringify(diagnostics.events)).not.toContain("hidden reasoning");
    expect(JSON.stringify(diagnostics.events)).not.toContain("hidden payload");
  });
});

describe("local Codex bridge loading performance", () => {
  it("serves unchanged incremental message requests from the cached full history", async () => {
    const threadReads: Array<{ includeTurns?: boolean; threadId?: string }> = [];
    const thread = {
      createdAt: 1_778_000_000,
      cwd: "/Users/reece/Desktop/Fast Project",
      ephemeral: false,
      id: "thread_fast",
      name: null,
      preview: "Make loading faster",
      status: { activeFlags: [], type: "idle" },
      turns: [
        {
          completedAt: 1_778_000_010,
          error: null,
          id: "turn_1",
          items: [
            {
              content: [{ text: "Hello", text_elements: [], type: "text" }],
              id: "item_user",
              type: "userMessage"
            },
            {
              id: "item_agent",
              text: "Hi there",
              type: "agentMessage"
            }
          ],
          startedAt: 1_778_000_000,
          status: { type: "completed" }
        }
      ],
      updatedAt: 1_778_000_010
    };
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/read") {
        const params = message.params as { includeTurns?: boolean; threadId?: string };
        threadReads.push(params);
        sendResult(socket, message.id, {
          thread: params.includeTurns === false ? { ...thread, turns: [] } : thread
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });
    const conversationId = "codex_thread_thread_fast";

    const initialMessages = await bridge.listMessages(conversationId);
    const latestSequence = Math.max(...initialMessages.map((message) => message.sequence));
    const incrementalMessages = await bridge.listMessages(conversationId, {
      afterSequence: latestSequence
    });

    expect(incrementalMessages).toEqual([]);
    expect(threadReads).toEqual([
      { includeTurns: true, threadId: "thread_fast" },
      { includeTurns: false, threadId: "thread_fast" }
    ]);
  });

  it("lists project conversations without reading full thread history", async () => {
    const calls: string[] = [];
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (typeof message.method === "string") {
        calls.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/loaded/list") {
        sendResult(socket, message.id, { data: [], nextCursor: null });
      }

      if (message.method === "thread/list") {
        sendResult(socket, message.id, {
          data: [
            {
              createdAt: 1_778_000_000,
              cwd: "/Users/reece/Desktop/Fast Project",
              ephemeral: false,
              id: "thread_fast",
              name: null,
              preview: "Make loading faster",
              status: { activeFlags: [], type: "active" },
              turns: [
                {
                  completedAt: null,
                  error: null,
                  id: "turn_fast",
                  items: [],
                  startedAt: 1_778_000_050,
                  status: "inProgress"
                }
              ],
              updatedAt: 1_778_000_050
            }
          ],
          nextCursor: null
        });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: {
            createdAt: 1_778_000_000,
            cwd: "/Users/reece/Desktop/Fast Project",
            ephemeral: false,
            id: "thread_fast",
            name: null,
            preview: "Make loading faster",
            status: { activeFlags: [], type: "active" },
            turns: [
              {
                completedAt: null,
                error: null,
                id: "turn_fast",
                items: [],
                startedAt: 1_778_000_050,
                status: "inProgress"
              }
            ],
            updatedAt: 1_778_000_050
          }
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    const [project] = await bridge.listProjects();
    const conversations = await bridge.listProjectConversations(project.id);

    expect(conversations).toEqual([
      expect.objectContaining({
        id: "codex_thread_thread_fast",
        prompt: "Make loading faster",
        worktreePath: "/Users/reece/Desktop/Fast Project"
      })
    ]);
    expect(calls.filter((method) => method === "thread/read")).toHaveLength(0);
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
  server.on("connection", (socket) => {
    socket.on("message", (raw) => onMessage(socket, JSON.parse(raw.toString())));
  });

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return { serverUrl: `ws://127.0.0.1:${address.port}` };
}

function sendResult(socket: WebSocket, id: number | undefined, result: unknown) {
  socket.send(JSON.stringify({ id, result }));
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
