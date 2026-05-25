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

  it("treats active thread snapshots with a completed latest turn as approved", async () => {
    const completedActiveThread = createThread({
      id: "thread_completed_active",
      preview: "Completed active thread",
      status: { activeFlags: [], type: "active" },
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
        sendResult(socket, message.id, { data: [completedActiveThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread: completedActiveThread });
      }
    });
    const bridge = createBridge(serverUrl);

    const [project] = await bridge.listProjects();
    const [conversation] = await bridge.listProjectConversations(project.id);
    const [completion] = await bridge.listCompletionStates();

    expect(conversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_completed_active",
        status: "approved"
      })
    );
    expect(completion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_completed_active",
        failed: false,
        isComplete: true,
        latestTurnId: "turn_completed",
        status: "approved"
      })
    );
  });

  it("hydrates idle no-turn summaries when completion states need the finished turn", async () => {
    let exposeIdleSummary = false;
    const runningSummary = createThread({
      id: "thread_completion_transition",
      preview: "Completion transition",
      status: { activeFlags: [], type: "active" },
      turns: [],
      updatedAt: 1_778_000_060
    });
    const runningThread = createThread({
      id: "thread_completion_transition",
      preview: "Completion transition",
      status: { activeFlags: [], type: "active" },
      turns: [
        createTurn({
          completedAt: null,
          id: "turn_transition",
          status: "inProgress"
        })
      ],
      updatedAt: 1_778_000_060
    });
    const completedSummary = createThread({
      id: "thread_completion_transition",
      preview: "Completion transition",
      status: { type: "idle" },
      turns: [],
      updatedAt: 1_778_000_090
    });
    const completedThread = createThread({
      id: "thread_completion_transition",
      preview: "Completion transition",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_090,
          id: "turn_transition",
          status: "completed"
        })
      ],
      updatedAt: 1_778_000_090
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      const params = message.params as { includeTurns?: boolean };
      if (message.method === "thread/list") {
        sendResult(socket, message.id, {
          data: [exposeIdleSummary ? completedSummary : runningSummary],
          nextCursor: null
        });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: exposeIdleSummary
            ? completedThread
            : params.includeTurns === false
              ? runningSummary
              : runningThread
        });
      }
    });
    const bridge = createBridge(serverUrl);

    const [runningCompletion] = await bridge.listCompletionStates();
    exposeIdleSummary = true;
    const [completedCompletion] = await bridge.listCompletionStates();

    expect(runningCompletion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_completion_transition",
        isComplete: false,
        latestTurnId: "turn_transition",
        status: "running"
      })
    );
    expect(completedCompletion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_completion_transition",
        isComplete: true,
        latestTurnId: "turn_transition",
        status: "approved"
      })
    );
  });

  it("hydrates recent idle no-turn summaries for completion notification polling", async () => {
    const completedSummary = createThread({
      id: "thread_recent_completion",
      preview: "Recent completion",
      status: { type: "idle" },
      turns: [],
      updatedAt: 1_778_000_090
    });
    const completedThread = createThread({
      id: "thread_recent_completion",
      preview: "Recent completion",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_090,
          id: "turn_recent_completion",
          status: "completed"
        })
      ],
      updatedAt: 1_778_000_090
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [completedSummary], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread: completedThread });
      }
    });
    const bridge = createBridge(serverUrl);

    const [completion] = await bridge.listCompletionStates({
      hydrateIdleSummariesSince: 1_778_000_080_000
    });

    expect(completion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_recent_completion",
        isComplete: true,
        latestTurnId: "turn_recent_completion",
        status: "approved"
      })
    );
  });

  it("keeps a locally started mobile turn running while Codex snapshots lag behind", async () => {
    const staleCompletedThread = createThread({
      id: "thread_mobile_started",
      preview: "Mobile started thread",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_050,
          id: "turn_previous",
          status: "completed"
        })
      ],
      updatedAt: 1_778_000_050
    });
    const completedMobileThread = createThread({
      id: "thread_mobile_started",
      preview: "Mobile started thread",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_050,
          id: "turn_previous",
          status: "completed"
        }),
        createTurn({
          completedAt: 1_778_000_090,
          id: "turn_mobile_started",
          status: "completed"
        })
      ],
      updatedAt: 1_778_000_090
    });
    let exposeCompletedTurn = false;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/list" || message.method === "thread/read") {
        sendResult(socket, message.id, {
          data:
            message.method === "thread/list"
              ? [exposeCompletedTurn ? completedMobileThread : staleCompletedThread]
              : undefined,
          nextCursor: message.method === "thread/list" ? null : undefined,
          thread:
            message.method === "thread/read"
              ? exposeCompletedTurn
                ? completedMobileThread
                : staleCompletedThread
              : undefined
        });
      }

      if (message.method === "thread/resume") {
        sendResult(socket, message.id, { thread: staleCompletedThread });
      }

      if (message.method === "turn/start") {
        sendResult(socket, message.id, {
          turn: createTurn({
            completedAt: null,
            id: "turn_mobile_started",
            status: "inProgress"
          })
        });
      }
    });
    const bridge = createBridge(serverUrl);

    await expect(
      bridge.continueConversation("codex_thread_thread_mobile_started", {
        prompt: "git"
      })
    ).resolves.toEqual({
      conversationId: "codex_thread_thread_mobile_started",
      status: "running"
    });

    const [project] = await bridge.listProjects();
    const [runningConversation] = await bridge.listProjectConversations(project.id);
    const [runningCompletion] = await bridge.listCompletionStates();

    expect(runningConversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_mobile_started",
        status: "running"
      })
    );
    expect(runningCompletion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_mobile_started",
        isComplete: false,
        latestTurnId: "turn_previous",
        status: "running"
      })
    );

    exposeCompletedTurn = true;
    const [approvedConversation] = await bridge.listProjectConversations(project.id);
    const [approvedCompletion] = await bridge.listCompletionStates();

    expect(approvedConversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_mobile_started",
        status: "approved"
      })
    );
    expect(approvedCompletion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_mobile_started",
        isComplete: true,
        latestTurnId: "turn_mobile_started",
        status: "approved"
      })
    );
  });

  it("stops forcing a locally started mobile turn running once Codex reports newer idle activity", async () => {
    const previousUpdatedAt = Math.floor(Date.now() / 1000) - 60;
    const completedUpdatedAt = Math.ceil(Date.now() / 1000) + 5;
    const staleCompletedThread = createThread({
      id: "thread_mobile_started_idle_summary",
      preview: "Mobile started idle summary",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: previousUpdatedAt,
          id: "turn_previous",
          status: "completed"
        })
      ],
      updatedAt: previousUpdatedAt
    });
    const completedSummary = createThread({
      id: "thread_mobile_started_idle_summary",
      preview: "Mobile started idle summary",
      status: { type: "idle" },
      turns: [],
      updatedAt: completedUpdatedAt
    });
    let exposeCompletedSummary = false;
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/list" || message.method === "thread/read") {
        const thread = exposeCompletedSummary ? completedSummary : staleCompletedThread;
        sendResult(socket, message.id, {
          data: message.method === "thread/list" ? [thread] : undefined,
          nextCursor: message.method === "thread/list" ? null : undefined,
          thread: message.method === "thread/read" ? thread : undefined
        });
      }

      if (message.method === "thread/resume") {
        sendResult(socket, message.id, { thread: staleCompletedThread });
      }

      if (message.method === "turn/start") {
        sendResult(socket, message.id, {
          turn: createTurn({
            completedAt: null,
            id: "turn_mobile_started",
            status: "inProgress"
          })
        });
      }
    });
    const bridge = createBridge(serverUrl);

    await bridge.continueConversation("codex_thread_thread_mobile_started_idle_summary", {
      prompt: "hihi"
    });

    const [project] = await bridge.listProjects();
    const [runningConversation] = await bridge.listProjectConversations(project.id);
    expect(runningConversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_mobile_started_idle_summary",
        status: "running"
      })
    );

    exposeCompletedSummary = true;
    const [approvedConversation] = await bridge.listProjectConversations(project.id);
    const [approvedCompletion] = await bridge.listCompletionStates();

    expect(approvedConversation).toEqual(
      expect.objectContaining({
        id: "codex_thread_thread_mobile_started_idle_summary",
        status: "approved"
      })
    );
    expect(approvedCompletion).toEqual(
      expect.objectContaining({
        conversationId: "codex_thread_thread_mobile_started_idle_summary",
        isComplete: false,
        latestTurnId: null,
        status: "approved"
      })
    );
  });

  it("does not reintroduce loaded-only archived threads into mobile project lists", async () => {
    const visibleThread = createThread({
      id: "thread_visible",
      preview: "Visible thread",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_050,
          id: "turn_visible",
          status: "completed"
        })
      ]
    });
    const archivedLoadedThread = createThread({
      id: "thread_archived",
      preview: "Archived loaded thread",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_060,
          id: "turn_archived",
          status: "completed"
        })
      ]
    });
    const { serverUrl } = await startMockCodexAppServer(
      (socket, message) => {
        const params = message.params as { threadId?: string };
        if (message.method === "thread/list") {
          sendResult(socket, message.id, { data: [visibleThread], nextCursor: null });
        }

        if (message.method === "thread/read") {
          sendResult(socket, message.id, {
            thread:
              params.threadId === archivedLoadedThread.id ? archivedLoadedThread : visibleThread
          });
        }
      },
      { loadedThreadIds: [visibleThread.id, archivedLoadedThread.id] }
    );
    const bridge = createBridge(serverUrl);

    const [project] = await bridge.listProjects();
    const conversations = await bridge.listProjectConversations(project.id);

    expect(conversations.map((conversation) => conversation.id)).toEqual([
      "codex_thread_thread_visible"
    ]);
  });

  it("does not rescue loaded archived threads that still look active in summary reads", async () => {
    const visibleThread = createThread({
      id: "thread_visible",
      preview: "Visible thread",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_050,
          id: "turn_visible",
          status: "completed"
        })
      ]
    });
    const archivedActiveSummary = createThread({
      id: "thread_archived_active",
      preview: "Archived active summary",
      status: { activeFlags: [], type: "active" },
      turns: []
    });
    const archivedHydratedThread = createThread({
      id: "thread_archived_active",
      preview: "Archived active summary",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_060,
          id: "turn_archived",
          status: "completed"
        })
      ]
    });
    const { serverUrl } = await startMockCodexAppServer(
      (socket, message) => {
        const params = message.params as { includeTurns?: boolean; threadId?: string };
        if (message.method === "thread/list") {
          sendResult(socket, message.id, { data: [visibleThread], nextCursor: null });
        }

        if (message.method === "thread/read") {
          if (params.threadId === archivedActiveSummary.id) {
            sendResult(socket, message.id, {
              thread: params.includeTurns ? archivedHydratedThread : archivedActiveSummary
            });
            return;
          }

          sendResult(socket, message.id, { thread: visibleThread });
        }
      },
      {
        archivedThreads: [archivedHydratedThread],
        loadedThreadIds: [visibleThread.id, archivedActiveSummary.id]
      }
    );
    const bridge = createBridge(serverUrl);

    const [project] = await bridge.listProjects();
    const conversations = await bridge.listProjectConversations(project.id);

    expect(conversations.map((conversation) => conversation.id)).toEqual([
      "codex_thread_thread_visible"
    ]);
  });

  it("does not reintroduce archived threads returned by Codex live lists", async () => {
    const visibleThread = createThread({
      id: "thread_visible",
      preview: "Visible thread",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_050,
          id: "turn_visible",
          status: "completed"
        })
      ]
    });
    const archivedLiveThread = createThread({
      id: "thread_archived_live",
      preview: "hi",
      status: { type: "idle" },
      turns: [
        createTurn({
          completedAt: 1_778_000_060,
          id: "turn_archived_live",
          status: "completed"
        })
      ]
    });
    const { serverUrl } = await startMockCodexAppServer(
      (socket, message) => {
        const params = message.params as { useStateDbOnly?: boolean };
        if (message.method === "thread/list") {
          sendResult(socket, message.id, {
            data:
              params.useStateDbOnly === false
                ? [visibleThread, archivedLiveThread]
                : [visibleThread],
            nextCursor: null
          });
        }

        if (message.method === "thread/read") {
          sendResult(socket, message.id, { thread: visibleThread });
        }
      },
      { archivedThreads: [archivedLiveThread] }
    );
    const bridge = createBridge(serverUrl);

    const [project] = await bridge.listProjects();
    const conversations = await bridge.listProjectConversations(project.id);

    expect(conversations.map((conversation) => conversation.id)).toEqual([
      "codex_thread_thread_visible"
    ]);
  });

  it("hides Codex subagent sidecar threads from mobile project thread lists", async () => {
    const parentThread = createThread({
      id: "thread_parent",
      preview: "Continue Story Engine Runtime",
      status: { activeFlags: [], type: "active" },
      turns: []
    });
    const subagentThread = createThread({
      agentNickname: "audit",
      agentRole: "read-only audit subagent",
      forkedFromId: parentThread.id,
      id: "thread_subagent",
      preview: "Read-only audit task B: validation artifact and baseline",
      status: { activeFlags: [], type: "active" },
      threadSource: {
        subAgent: {
          parentThreadId: parentThread.id
        }
      },
      turns: []
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      const params = message.params as { threadId?: string };
      if (message.method === "thread/list") {
        sendResult(socket, message.id, { data: [parentThread, subagentThread], nextCursor: null });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: params.threadId === subagentThread.id ? subagentThread : parentThread
        });
      }
    });
    const bridge = createBridge(serverUrl);

    const projects = await bridge.listProjects();
    const conversations = await bridge.listProjectConversations(projects[0]!.id);

    expect(projects).toEqual([
      expect.objectContaining({
        conversationCount: 1
      })
    ]);
    expect(conversations.map((conversation) => conversation.id)).toEqual([
      "codex_thread_thread_parent"
    ]);
  });

  it("groups desktop Codex chats into a synthetic mobile Chats project without legacy CLI sessions", async () => {
    const projectThread = createThread({
      id: "thread_project",
      preview: "Project-backed thread",
      source: "vscode",
      status: { type: "idle" },
      updatedAt: 1_778_000_050,
      turns: [
        createTurn({
          completedAt: 1_778_000_050,
          id: "turn_project",
          status: "completed"
        })
      ]
    });
    const legacyCliThread = createThread({
      cwd: "/Users/reece",
      id: "thread_chat",
      preview: "Play Ed Sheeran in Apple Music",
      source: "cli",
      status: { type: "idle" },
      updatedAt: 1_778_000_060,
      turns: [
        createTurn({
          completedAt: 1_778_000_060,
          id: "turn_chat",
          status: "completed"
        })
      ]
    });
    const desktopChatThread = createThread({
      cwd: "/Users/reece/Documents/Codex/2026-05-25/reply-hello-only",
      id: "thread_desktop_chat",
      preview: "reply hello only",
      source: "vscode",
      status: { type: "idle" },
      updatedAt: 1_778_000_070,
      turns: [
        createTurn({
          completedAt: 1_778_000_070,
          id: "turn_desktop_chat",
          status: "completed"
        })
      ]
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "thread/list") {
        sendResult(socket, message.id, {
          data: [desktopChatThread, legacyCliThread, projectThread],
          nextCursor: null
        });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, { thread: projectThread });
      }
    });
    const bridge = createBridge(serverUrl);

    const projects = await bridge.listProjects();
    const chatConversations = await bridge.listProjectConversations("codex_project_chats");
    const completionStates = await bridge.listCompletionStates();

    expect(projects.map((project) => project.name)).toEqual(["Chats", "Abitat_Workspace"]);
    expect(projects).toEqual([
      expect.objectContaining({
        conversationCount: 1,
        hostLocalPath: "",
        id: "codex_project_chats",
        repoUrl: ""
      }),
      expect.objectContaining({
        conversationCount: 1,
        hostLocalPath: cwd,
        name: "Abitat_Workspace"
      })
    ]);
    expect(chatConversations.map((conversation) => conversation.id)).toEqual([
      "codex_thread_thread_desktop_chat"
    ]);
    expect(chatConversations.map((conversation) => conversation.projectId)).toEqual([
      "codex_project_chats"
    ]);
    expect(chatConversations.map((conversation) => conversation.worktreePath)).toEqual([null]);
    expect(
      completionStates
        .filter((state) => state.projectId === "codex_project_chats")
        .map((state) => state.projectName)
    ).toEqual(["Chats"]);
    expect(JSON.stringify(projects)).not.toContain(legacyCliThread.id);
    expect(JSON.stringify(chatConversations)).not.toContain(legacyCliThread.id);
    expect(JSON.stringify(completionStates)).not.toContain(legacyCliThread.id);
  });

  it("starts new standalone Codex chats from the synthetic mobile Chats project", async () => {
    let startThreadParams: unknown = null;
    let startTurnParams: unknown = null;
    const newChatThread = createThread({
      cwd: "/Users/reece/Documents/Codex/2026-05-25/new-chat",
      id: "thread_new_chat",
      preview: "New chat",
      source: "vscode",
      status: { type: "idle" },
      updatedAt: 1_778_000_080
    });
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method === "thread/start") {
        startThreadParams = message.params;
        sendResult(socket, message.id, { thread: newChatThread });
      }

      if (message.method === "turn/start") {
        startTurnParams = message.params;
        sendResult(socket, message.id, {
          turn: createTurn({
            completedAt: 1_778_000_090,
            id: "turn_new_chat",
            status: "completed"
          })
        });
      }
    });
    const bridge = createBridge(serverUrl);

    await expect(
      bridge.startConversation("codex_project_chats", { prompt: "hello from phone" })
    ).resolves.toEqual({
      conversationId: "codex_thread_thread_new_chat",
      status: "running"
    });
    expect(startThreadParams).toEqual(
      expect.objectContaining({
        cwd: null,
        experimentalRawEvents: false,
        persistExtendedHistory: true
      })
    );
    expect(startTurnParams).toEqual(
      expect.objectContaining({
        cwd: "/Users/reece/Documents/Codex/2026-05-25/new-chat",
        input: [
          {
            text: "hello from phone",
            text_elements: [],
            type: "text"
          }
        ],
        threadId: "thread_new_chat"
      })
    );
  });

  it("does not include archived standalone Codex chats in the synthetic mobile Chats project", async () => {
    const activeChatThread = createThread({
      cwd: "/Users/reece/Documents/Codex/2026-05-25/active-chat",
      id: "thread_active_chat",
      preview: "active chat",
      source: "vscode",
      status: { type: "idle" },
      updatedAt: 1_778_000_090,
      turns: [
        createTurn({
          completedAt: 1_778_000_090,
          id: "turn_active_chat",
          status: "completed"
        })
      ]
    });
    const archivedChatThread = createThread({
      cwd: "/Users/reece/Documents/Codex/2026-05-24/archived-chat",
      id: "thread_archived_chat",
      preview: "archived chat",
      source: "vscode",
      status: { activeFlags: [], type: "active" },
      updatedAt: 1_777_900_000,
      turns: []
    });
    const { serverUrl } = await startMockCodexAppServer(
      (socket, message) => {
        const params = message.params as { useStateDbOnly?: boolean };
        if (message.method === "thread/list") {
          sendResult(socket, message.id, {
            data:
              params.useStateDbOnly === false
                ? [activeChatThread, archivedChatThread]
                : [activeChatThread],
            nextCursor: null
          });
        }
      },
      { archivedThreads: [archivedChatThread] }
    );
    const bridge = createBridge(serverUrl);

    const projects = await bridge.listProjects();
    const chatConversations = await bridge.listProjectConversations("codex_project_chats");

    expect(projects).toEqual([
      expect.objectContaining({
        conversationCount: 1,
        id: "codex_project_chats",
        name: "Chats"
      })
    ]);
    expect(chatConversations.map((conversation) => conversation.id)).toEqual([
      "codex_thread_thread_active_chat"
    ]);
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
  options: { archivedThreads?: unknown[]; loadedThreadIds?: string[] } = {}
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

      if (
        message.method === "thread/list" &&
        (message.params as { archived?: boolean } | undefined)?.archived === true
      ) {
        sendResult(socket, message.id, { data: options.archivedThreads ?? [], nextCursor: null });
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
    agentNickname?: string | null;
    agentRole?: string | null;
    cwd?: string;
    forkedFromId?: string | null;
    id?: string;
    preview?: string;
    source?: string | null;
    status?: unknown;
    threadSource?: unknown;
    turns?: unknown[];
    updatedAt?: number;
  } = {}
) {
  return {
    createdAt: 1_778_000_000,
    cwd: input.cwd ?? cwd,
    ephemeral: false,
    id: input.id ?? "thread_active",
    name: null,
    preview: input.preview ?? "Desktop running thread",
    source: input.source ?? "vscode",
    status: input.status ?? { activeFlags: [], type: "active" },
    threadSource: input.threadSource ?? null,
    agentNickname: input.agentNickname ?? null,
    agentRole: input.agentRole ?? null,
    forkedFromId: input.forkedFromId ?? null,
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
