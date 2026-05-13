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
  it("falls back to thread summaries for unmaterialized Codex threads without error diagnostics", async () => {
    const diagnostics = createMemoryDiagnostics();
    const threadReads: Array<{ includeTurns?: boolean; threadId?: string }> = [];
    const summaryThread = {
      createdAt: 1_778_000_000,
      cwd: "/Users/reece/Desktop/Empty Project",
      ephemeral: false,
      id: "thread_empty",
      name: null,
      preview: "Empty thread",
      status: { activeFlags: [], type: "idle" },
      turns: [],
      updatedAt: 1_778_000_010
    };
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/loaded/list") {
        sendResult(socket, message.id, { data: [], nextCursor: null });
      }

      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [summaryThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        const params = message.params as { includeTurns?: boolean; threadId?: string };
        threadReads.push(params);
        if (params.includeTurns) {
          sendError(
            socket,
            message.id,
            `thread ${params.threadId} is not materialized yet; includeTurns is unavailable before first user message`
          );
          return;
        }

        sendResult(socket, message.id, { thread: summaryThread });
      }
    });
    const bridge = createLocalCodexBridge({
      codexBinaryPath: "/unused",
      diagnostics,
      serverUrl
    });

    const completionStates = await bridge.listCompletionStates();

    expect(completionStates).toEqual([
      expect.objectContaining({
        conversationId: "codex_thread_thread_empty",
        latestTurnId: null,
        status: "approved"
      })
    ]);
    expect(threadReads).toEqual([
      { includeTurns: true, threadId: "thread_empty" },
      { includeTurns: false, threadId: "thread_empty" }
    ]);
    expect(diagnostics.events).not.toContainEqual(
      expect.objectContaining({ event: "codex.thread_read.failure", level: "error" })
    );
    expect(diagnostics.events).toContainEqual(
      expect.objectContaining({
        event: "codex.thread_read.unmaterialized",
        level: "info",
        threadId: "thread_empty"
      })
    );
  });

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

  it("bypasses cached message history when mobile requests a forced refresh", async () => {
    const staleSummary = {
      createdAt: 1_778_000_000,
      cwd: "/Users/reece/Desktop/Fast Project",
      ephemeral: false,
      id: "thread_fast",
      name: null,
      preview: "Make loading faster",
      status: { activeFlags: [], type: "idle" },
      turns: [],
      updatedAt: 1_778_000_010
    };
    let fullThread = {
      ...staleSummary,
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
      ]
    };
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/read") {
        const params = message.params as { includeTurns?: boolean; threadId?: string };
        sendResult(socket, message.id, {
          thread: params.includeTurns === false ? staleSummary : fullThread
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });
    const conversationId = "codex_thread_thread_fast";

    const initialMessages = await bridge.listMessages(conversationId);
    const latestSequence = Math.max(...initialMessages.map((message) => message.sequence));
    fullThread = {
      ...fullThread,
      turns: [
        ...fullThread.turns,
        {
          completedAt: 1_778_000_030,
          error: null,
          id: "turn_2",
          items: [
            {
              content: [{ text: "New desktop prompt", text_elements: [], type: "text" }],
              id: "item_user_2",
              type: "userMessage"
            },
            {
              id: "item_agent_2",
              text: "New desktop reply",
              type: "agentMessage"
            }
          ],
          startedAt: 1_778_000_020,
          status: { type: "completed" }
        }
      ],
      updatedAt: 1_778_000_030
    };

    const refreshedMessages = await bridge.listMessages(conversationId, {
      afterSequence: latestSequence,
      forceRefresh: true
    });

    expect(refreshedMessages).toEqual([
      expect.objectContaining({
        content: "New desktop prompt",
        role: "user"
      }),
      expect.objectContaining({
        content: "New desktop reply",
        role: "assistant"
      })
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

  it("injects persisted desktop turns into the loaded Codex model context before a phone continuation", async () => {
    const calls: string[] = [];
    let injectParams: Record<string, unknown> | null = null;
    let startParams: Record<string, unknown> | null = null;
    const thread = {
      createdAt: 1_778_000_000,
      cwd: "/Users/reece/Desktop/Context Project",
      ephemeral: false,
      id: "thread_context",
      name: null,
      preview: "Remember birthdays",
      status: { activeFlags: [], type: "idle" },
      turns: [
        {
          completedAt: 1_778_000_010,
          error: null,
          id: "turn_phone",
          items: [
            {
              content: [{ text: "When is Reece's birthday?", text_elements: [], type: "text" }],
              id: "item_phone_user",
              type: "userMessage"
            },
            {
              id: "item_phone_agent",
              text: "Reece's birthday is December 23.",
              type: "agentMessage"
            }
          ],
          startedAt: 1_778_000_000,
          status: { type: "completed" }
        },
        {
          completedAt: 1_778_000_030,
          error: null,
          id: "turn_desktop",
          items: [
            {
              content: [{ text: "Iris birthday is Oct 6", text_elements: [], type: "text" }],
              id: "item_desktop_user",
              type: "userMessage"
            },
            {
              id: "item_desktop_agent",
              text: "Got it, Iris birthday is Oct 6.",
              type: "agentMessage"
            }
          ],
          startedAt: 1_778_000_020,
          status: { type: "completed" }
        }
      ],
      updatedAt: 1_778_000_030
    };
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (typeof message.method === "string") {
        calls.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread });
      }

      if (message.method === "thread/loaded/list") {
        sendResult(socket, message.id, { data: ["thread_context"], nextCursor: null });
      }

      if (message.method === "thread/resume") {
        sendResult(socket, message.id, { thread });
      }

      if (message.method === "thread/inject_items") {
        injectParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, {});
      }

      if (message.method === "turn/start") {
        startParams = message.params as Record<string, unknown>;
        sendResult(socket, message.id, {
          turn: {
            completedAt: null,
            error: null,
            id: "turn_mobile_after_desktop",
            items: [],
            startedAt: 1_778_000_040,
            status: { type: "inProgress" }
          }
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    await expect(
      bridge.continueConversation("codex_thread_thread_context", {
        prompt: "When is Iris birthday?"
      })
    ).resolves.toEqual({
      conversationId: "codex_thread_thread_context",
      status: "running"
    });

    expect(injectParams).toEqual({
      items: [
        {
          content: [{ text: "When is Reece's birthday?", type: "input_text" }],
          role: "user",
          type: "message"
        },
        {
          content: [{ text: "Iris birthday is Oct 6", type: "input_text" }],
          role: "user",
          type: "message"
        }
      ],
      threadId: "thread_context"
    });
    expect(startParams).toMatchObject({
      input: [{ text: "When is Iris birthday?", text_elements: [], type: "text" }],
      threadId: "thread_context"
    });
    expect(calls.indexOf("thread/inject_items")).toBeLessThan(calls.indexOf("turn/start"));
  });

  it("syncs only desktop turns added after the previous phone turn in alternating desktop and mobile chat", async () => {
    let phase: "reece" | "iris" = "reece";
    let startCount = 0;
    const injectedItems: unknown[] = [];
    const reeceThread = {
      createdAt: 1_778_000_000,
      cwd: "/Users/reece/Desktop/Context Project",
      ephemeral: false,
      id: "thread_context",
      name: null,
      preview: "Remember birthdays",
      status: { activeFlags: [], type: "idle" },
      turns: [
        {
          completedAt: 1_778_000_010,
          error: null,
          id: "turn_desktop_reece",
          items: [
            {
              content: [{ text: "Reece birthday is Dec 23", text_elements: [], type: "text" }],
              id: "item_reece_user",
              type: "userMessage"
            },
            {
              id: "item_reece_agent",
              text: "Got it, Reece birthday is Dec 23.",
              type: "agentMessage"
            }
          ],
          startedAt: 1_778_000_000,
          status: { type: "completed" }
        }
      ],
      updatedAt: 1_778_000_010
    };
    const irisThread = {
      ...reeceThread,
      turns: [
        ...reeceThread.turns,
        {
          completedAt: 1_778_000_030,
          error: null,
          id: "turn_phone_reece",
          items: [
            {
              content: [{ text: "When is Reece's birthday?", text_elements: [], type: "text" }],
              id: "item_phone_reece_user",
              type: "userMessage"
            },
            {
              id: "item_phone_reece_agent",
              text: "Reece birthday is Dec 23.",
              type: "agentMessage"
            }
          ],
          startedAt: 1_778_000_020,
          status: { type: "completed" }
        },
        {
          completedAt: 1_778_000_050,
          error: null,
          id: "turn_desktop_iris",
          items: [
            {
              content: [{ text: "Iris birthday is Oct 6", text_elements: [], type: "text" }],
              id: "item_iris_user",
              type: "userMessage"
            },
            {
              id: "item_iris_agent",
              text: "Got it, Iris birthday is Oct 6.",
              type: "agentMessage"
            }
          ],
          startedAt: 1_778_000_040,
          status: { type: "completed" }
        }
      ],
      updatedAt: 1_778_000_050
    };
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: phase === "reece" ? reeceThread : irisThread
        });
      }

      if (message.method === "thread/loaded/list") {
        sendResult(socket, message.id, { data: ["thread_context"], nextCursor: null });
      }

      if (message.method === "thread/resume") {
        sendResult(socket, message.id, {
          thread: phase === "reece" ? reeceThread : irisThread
        });
      }

      if (message.method === "thread/inject_items") {
        injectedItems.push((message.params as { items?: unknown[] }).items);
        sendResult(socket, message.id, {});
      }

      if (message.method === "turn/start") {
        startCount += 1;
        sendResult(socket, message.id, {
          turn: {
            completedAt: 1_778_000_060 + startCount,
            error: null,
            id: startCount === 1 ? "turn_phone_reece" : "turn_phone_iris",
            items: [],
            startedAt: 1_778_000_060,
            status: { type: "completed" }
          }
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    await bridge.continueConversation("codex_thread_thread_context", {
      prompt: "When is Reece's birthday?"
    });
    phase = "iris";
    await bridge.continueConversation("codex_thread_thread_context", {
      prompt: "When is Iris birthday?"
    });

    expect(injectedItems).toEqual([
      [
        {
          content: [{ text: "Reece birthday is Dec 23", type: "input_text" }],
          role: "user",
          type: "message"
        }
      ],
      [
        {
          content: [{ text: "Iris birthday is Oct 6", type: "input_text" }],
          role: "user",
          type: "message"
        },
        {
          content: [{ text: "Got it, Iris birthday is Oct 6.", type: "output_text" }],
          role: "assistant",
          type: "message"
        }
      ]
    ]);
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

function sendError(socket: WebSocket, id: number | undefined, message: string) {
  socket.send(JSON.stringify({ error: { message }, id }));
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
