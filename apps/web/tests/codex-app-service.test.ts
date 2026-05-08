import { describe, expect, it } from "vitest";

import {
  CodexConversationBusyError,
  codexAppDeepLink,
  createCodexAppService,
  externalCodexConversationId,
  externalCodexProjectId,
  isCodexConversationBusyError,
  isCodexConversationId,
  isCodexProjectId,
  toCodexThreadId,
  type CodexAppClient,
  type CodexAppThread,
  type CodexAppTurn
} from "../server/codex-app/codex-app-service";

function createThread(input: Partial<CodexAppThread> & Pick<CodexAppThread, "id" | "cwd">) {
  return {
    cliVersion: "0.0.0",
    createdAt: 1_775_000_000,
    cwd: input.cwd,
    ephemeral: false,
    forkedFromId: null,
    gitInfo: null,
    id: input.id,
    modelProvider: "openai",
    name: input.name ?? null,
    path: input.path ?? null,
    preview: input.preview ?? "",
    source: "appServer",
    status: input.status ?? { type: "idle" },
    turns: input.turns ?? [],
    updatedAt: input.updatedAt ?? 1_775_000_010
  } satisfies CodexAppThread;
}

function createTurn(input: Partial<CodexAppTurn> & Pick<CodexAppTurn, "id">) {
  return {
    completedAt: input.completedAt ?? null,
    durationMs: input.durationMs ?? null,
    error: input.error ?? null,
    id: input.id,
    items: input.items ?? [],
    startedAt: input.startedAt ?? 1_775_000_020,
    status: input.status ?? "inProgress"
  } satisfies CodexAppTurn;
}

interface FakeCodexAppClient extends CodexAppClient {
  injectedItems: Array<{
    items: unknown[];
    threadId: string;
  }>;
  loadedThreadRequests: number;
  readThreadRequests: Array<{
    includeTurns: boolean;
    threadId: string;
  }>;
  resumedThreadRequests: Array<{
    excludeTurns?: boolean;
    threadId: string;
  }>;
  operations: string[];
  resumedThreads: string[];
  startedTurns: Array<{
    approvalPolicy?: unknown;
    cwd?: string | null;
    effort?: unknown;
    input: string;
    model?: unknown;
    sandboxPolicy?: unknown;
    threadId: string;
  }>;
  startedThreads: string[];
  resumeThread(params: {
    threadId: string;
    excludeTurns?: boolean;
  }): Promise<{ thread: CodexAppThread }>;
}

interface FakeActivityLog {
  events: Array<{ details?: Record<string, unknown>; event: string }>;
  record(event: string, details?: Record<string, unknown>): void;
}

function createFakeActivityLog(): FakeActivityLog {
  const events: FakeActivityLog["events"] = [];

  return {
    events,
    record(event, details) {
      events.push({ details, event });
    }
  };
}

function createFakeClient(
  threads: CodexAppThread[],
  clientOptions: {
    loadedThreadIds?: string[];
    emptyStateDbThreadList?: boolean;
    omitTurnsFromList?: boolean;
    rejectUnloadedTurns?: boolean;
    startTurnIds?: string[];
    startTurnError?: Error;
  } = {}
): FakeCodexAppClient {
  const injectedItems: FakeCodexAppClient["injectedItems"] = [];
  let loadedThreadRequests = 0;
  const operations: string[] = [];
  const readThreadRequests: FakeCodexAppClient["readThreadRequests"] = [];
  const resumedThreadRequests: FakeCodexAppClient["resumedThreadRequests"] = [];
  const resumedThreads: string[] = [];
  const startedTurns: FakeCodexAppClient["startedTurns"] = [];
  const startedThreads: string[] = [];

  return {
    get loadedThreadRequests() {
      return loadedThreadRequests;
    },
    injectedItems,
    async injectItems(threadId, items) {
      operations.push(`inject:${threadId}`);
      injectedItems.push({ items, threadId });
    },
    async listLoadedThreads() {
      loadedThreadRequests += 1;
      return clientOptions.loadedThreadIds ?? [];
    },
    async listModels() {
      return [
        {
          defaultReasoningEffort: "medium",
          description: "Best for agentic coding.",
          displayName: "GPT-5.3 Codex",
          id: "gpt-5.3-codex",
          isDefault: true,
          supportedReasoningEfforts: ["minimal", "medium", "high", "xhigh"]
        },
        {
          defaultReasoningEffort: "low",
          description: "Fast coding model.",
          displayName: "GPT-5.4 Mini",
          id: "gpt-5.4-mini",
          isDefault: false,
          supportedReasoningEfforts: ["low", "medium"]
        }
      ];
    },
    operations,
    readThreadRequests,
    resumedThreadRequests,
    resumedThreads,
    startedThreads,
    startedTurns,
    async listThreads(params = {}) {
      const cwd = Array.isArray(params.cwd) ? params.cwd[0] : params.cwd;
      const data = cwd ? threads.filter((thread) => thread.cwd === cwd) : threads;
      if (clientOptions.emptyStateDbThreadList && params.useStateDbOnly) {
        return {
          backwardsCursor: null,
          data: [],
          nextCursor: null
        };
      }
      return {
        backwardsCursor: null,
        data: clientOptions.omitTurnsFromList
          ? data.map((thread) => ({ ...thread, turns: [] }))
          : data,
        nextCursor: null
      };
    },
    async readThread(threadId, includeTurns = true) {
      readThreadRequests.push({ includeTurns, threadId });
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) {
        throw new Error(`Missing thread ${threadId}`);
      }

      return thread;
    },
    async startThread(params) {
      const thread = createThread({
        cwd: params.cwd ?? "/Users/reece/Desktop/Untitled",
        id: "thread_new",
        preview: "New phone prompt",
        status: { type: "active", activeFlags: [] }
      });
      threads.push(thread);
      startedThreads.push(thread.cwd);
      return { thread };
    },
    async resumeThread(params) {
      const thread = threads.find((candidate) => candidate.id === params.threadId);
      if (!thread) {
        throw new Error(`Missing thread ${params.threadId}`);
      }

      thread.status = { type: "idle" };
      resumedThreadRequests.push({
        excludeTurns: params.excludeTurns,
        threadId: params.threadId
      });
      resumedThreads.push(params.threadId);
      operations.push(`resume:${params.threadId}`);
      return { thread };
    },
    async startTurn(threadId, input, options) {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (clientOptions.rejectUnloadedTurns && thread?.status.type === "notLoaded") {
        throw new Error(`thread not found: ${threadId}`);
      }
      if (clientOptions.startTurnError) {
        throw clientOptions.startTurnError;
      }

      const text = input
        .filter((item): item is { type: "text"; text: string; text_elements: [] } => {
          return item.type === "text";
        })
        .map((item) => item.text)
        .join("\n");

      operations.push(`start:${threadId}`);
      startedTurns.push({
        approvalPolicy: options?.approvalPolicy,
        cwd: options?.cwd,
        effort: options?.effort,
        input: text,
        model: options?.model,
        sandboxPolicy: options?.sandboxPolicy,
        threadId
      });
      return {
        turn: {
          completedAt: null,
          durationMs: null,
          error: null,
          id: clientOptions.startTurnIds?.shift() ?? "turn_new",
          items: [],
          startedAt: 1_775_000_020,
          status: { type: "running" }
        }
      };
    }
  };
}

describe("Codex app service", () => {
  it("groups Codex desktop app threads into folder-like projects by cwd", async () => {
    const client = createFakeClient([
      createThread({
        cwd: "/Users/reece/Desktop/Abitat_Workspace",
        id: "thread_a",
        preview: "Add phone control",
        updatedAt: 1_775_000_030
      }),
      createThread({
        cwd: "/Users/reece/Desktop/Abitat_Workspace",
        id: "thread_b",
        preview: "Fix pairing"
      }),
      createThread({
        cwd: "/Users/reece/Desktop/Other Project",
        id: "thread_c",
        name: "Other work"
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const projects = await service.listProjects();

    expect(projects).toEqual([
      expect.objectContaining({
        conversationCount: 2,
        hostLocalPath: "/Users/reece/Desktop/Abitat_Workspace",
        id: externalCodexProjectId("/Users/reece/Desktop/Abitat_Workspace"),
        name: "Abitat_Workspace",
        repoSyncStatus: "codex_app",
        source: "codex_app"
      }),
      expect.objectContaining({
        conversationCount: 1,
        hostLocalPath: "/Users/reece/Desktop/Other Project",
        id: externalCodexProjectId("/Users/reece/Desktop/Other Project"),
        name: "Other Project",
        source: "codex_app"
      })
    ]);
  });

  it("falls back to the full Codex app thread list when the state DB list is empty", async () => {
    const activityLog = createFakeActivityLog();
    const client = createFakeClient(
      [
        createThread({
          cwd: "/Users/reece/Desktop/Abitat_Workspace",
          id: "thread_a",
          preview: "Add phone control"
        })
      ],
      { emptyStateDbThreadList: true }
    );
    const service = createCodexAppService(client, {
      activityLog,
      workspaceId: "workspace_demo"
    });

    await expect(service.listProjects()).resolves.toEqual([
      expect.objectContaining({
        conversationCount: 1,
        hostLocalPath: "/Users/reece/Desktop/Abitat_Workspace",
        name: "Abitat_Workspace",
        source: "codex_app"
      })
    ]);
    expect(activityLog.events).toEqual(
      expect.arrayContaining([
        {
          details: expect.objectContaining({
            mode: "full_thread_list"
          }),
          event: "codex_app_thread_list_state_db_empty"
        }
      ])
    );
  });

  it("lists conversations for a Codex project without using Abitat CLI jobs", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_a",
        preview: "Add iPhone app",
        status: { type: "active", activeFlags: [] }
      }),
      createThread({
        cwd: "/Users/reece/Desktop/Other",
        id: "thread_b",
        preview: "Other"
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const conversations = await service.listProjectConversations(externalCodexProjectId(cwd));

    expect(conversations).toEqual([
      expect.objectContaining({
        id: externalCodexConversationId("thread_a"),
        projectId: externalCodexProjectId(cwd),
        prompt: "Add iPhone app",
        runtimeSessionId: "thread_a",
        source: "codex_app",
        status: "running",
        worktreePath: cwd
      })
    ]);
  });

  it("lists Codex project conversations from thread summaries without reading full turn history", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_a",
        preview: "Add iPhone app",
        turns: [
          {
            completedAt: 1_775_000_050,
            durationMs: 1000,
            error: null,
            id: "turn_a",
            items: [
              {
                id: "item_agent",
                memoryCitation: null,
                phase: null,
                text: "Done.",
                type: "agentMessage"
              }
            ],
            startedAt: 1_775_000_040,
            status: "completed"
          }
        ]
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await service.listProjectConversations(externalCodexProjectId(cwd));

    expect(client.readThreadRequests).toEqual([]);
  });

  it("refreshes active Codex project summaries with full turns before reporting completion", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient(
      [
        createThread({
          cwd,
          id: "thread_finished",
          preview: "Finished on the Mac",
          status: { activeFlags: [], type: "active" },
          turns: [
            createTurn({
              completedAt: 1_775_000_050,
              id: "turn_finished",
              items: [
                {
                  id: "item_agent",
                  memoryCitation: null,
                  phase: null,
                  text: "Finished.",
                  type: "agentMessage"
                }
              ],
              status: "completed"
            })
          ],
          updatedAt: 1_775_000_050
        })
      ],
      { omitTurnsFromList: true }
    );
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const [conversation] = await service.listProjectConversations(externalCodexProjectId(cwd));

    expect(conversation).toEqual(
      expect.objectContaining({
        id: externalCodexConversationId("thread_finished"),
        status: "approved"
      })
    );
    expect(client.readThreadRequests).toEqual([
      { includeTurns: true, threadId: "thread_finished" }
    ]);
  });

  it("does not leave interrupted Codex app turns marked as running", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_interrupted",
        preview: "Interrupted on the Mac",
        status: { type: "active", activeFlags: ["waitingOnApproval"] },
        turns: [
          {
            completedAt: 1_775_000_050,
            durationMs: 1000,
            error: null,
            id: "turn_interrupted",
            items: [
              {
                id: "item_agent",
                memoryCitation: null,
                phase: null,
                text: "Interrupted while waiting for approval.",
                type: "agentMessage"
              }
            ],
            startedAt: 1_775_000_040,
            status: "interrupted"
          }
        ],
        updatedAt: 1_775_000_050
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const [conversation] = await service.listProjectConversations(externalCodexProjectId(cwd));
    const completion = (await service.listCompletionStates())[0];

    expect(conversation).toEqual(
      expect.objectContaining({
        id: externalCodexConversationId("thread_interrupted"),
        status: "cancelled"
      })
    );
    expect(completion).toEqual(
      expect.objectContaining({
        conversationId: externalCodexConversationId("thread_interrupted"),
        failed: true,
        isComplete: true,
        latestTurnCompletedAt: "2026-03-31T23:34:10.000Z",
        latestTurnId: "turn_interrupted",
        status: "cancelled"
      })
    );
  });

  it("does not mark transient Codex app system errors as failed without a failed turn", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_transient_error",
        preview: "Transient network issue",
        status: { type: "systemError" },
        turns: [
          createTurn({
            completedAt: null,
            error: null,
            id: "turn_in_progress",
            status: { type: "inProgress" }
          })
        ],
        updatedAt: 1_775_000_050
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const [conversation] = await service.listProjectConversations(externalCodexProjectId(cwd));
    const [completion] = await service.listCompletionStates();

    expect(conversation).toEqual(
      expect.objectContaining({
        id: externalCodexConversationId("thread_transient_error"),
        status: "running"
      })
    );
    expect(completion).toEqual(
      expect.objectContaining({
        conversationId: externalCodexConversationId("thread_transient_error"),
        failed: false,
        isComplete: false,
        latestTurnId: "turn_in_progress",
        status: "running"
      })
    );
  });

  it("resumes a Codex app system-error thread before starting a phone turn", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_recovered",
        preview: "Recover after network issue",
        status: { type: "systemError" },
        turns: [
          createTurn({
            completedAt: 1_775_000_050,
            error: null,
            id: "turn_done",
            status: "completed"
          })
        ]
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await expect(
      service.continueConversation(externalCodexConversationId("thread_recovered"), {
        prompt: "Continue execution"
      })
    ).resolves.toEqual({
      conversationId: externalCodexConversationId("thread_recovered"),
      status: "running"
    });

    expect(client.operations).toEqual(["resume:thread_recovered", "start:thread_recovered"]);
  });

  it("flattens Codex app thread history into mobile chat messages", async () => {
    const client = createFakeClient([
      createThread({
        cwd: "/Users/reece/Desktop/Abitat_Workspace",
        id: "thread_a",
        turns: [
          {
            completedAt: 1_775_000_006,
            durationMs: 1000,
            error: null,
            id: "turn_a",
            items: [
              {
                content: [
                  { text: "Can you inspect this project?", text_elements: [], type: "text" }
                ],
                id: "item_user",
                type: "userMessage"
              },
              {
                id: "item_agent",
                memoryCitation: null,
                phase: null,
                text: "I will inspect the project structure.",
                type: "agentMessage"
              },
              {
                aggregatedOutput: "README.md\napps\n",
                command: "ls",
                commandActions: [],
                cwd: "/Users/reece/Desktop/Abitat_Workspace",
                durationMs: 10,
                exitCode: 0,
                id: "item_command",
                processId: null,
                source: "localShell",
                status: "completed",
                type: "commandExecution"
              }
            ],
            startedAt: 1_775_000_005,
            status: { type: "completed" }
          }
        ]
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const messages = await service.listMessages(externalCodexConversationId("thread_a"));

    expect(messages).toEqual([
      expect.objectContaining({
        content: "Can you inspect this project?",
        conversationId: externalCodexConversationId("thread_a"),
        role: "user",
        sequence: 1
      }),
      expect.objectContaining({
        content: "I will inspect the project structure.",
        role: "assistant",
        sequence: 2
      }),
      expect.objectContaining({
        content: "README.md\napps",
        role: "runtime",
        sequence: 3
      })
    ]);
  });

  it("can omit runtime command output from mobile Codex message history", async () => {
    const client = createFakeClient([
      createThread({
        cwd: "/Users/reece/Desktop/Abitat_Workspace",
        id: "thread_a",
        turns: [
          {
            completedAt: 1_775_000_006,
            durationMs: 1000,
            error: null,
            id: "turn_a",
            items: [
              {
                content: [
                  { text: "Can you inspect this project?", text_elements: [], type: "text" }
                ],
                id: "item_user",
                type: "userMessage"
              },
              {
                aggregatedOutput: "x".repeat(20_000),
                command: "pnpm test",
                commandActions: [],
                cwd: "/Users/reece/Desktop/Abitat_Workspace",
                durationMs: 10,
                exitCode: 0,
                id: "item_command",
                processId: null,
                source: "localShell",
                status: "completed",
                type: "commandExecution"
              },
              {
                id: "item_agent",
                memoryCitation: null,
                phase: null,
                text: "I will inspect the project structure.",
                type: "agentMessage"
              }
            ],
            startedAt: 1_775_000_005,
            status: { type: "completed" }
          }
        ]
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const messages = await service.listMessages(externalCodexConversationId("thread_a"), {
      includeRuntime: false
    });

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("returns current Codex messages when a stale runtime-including cursor is beyond the visible history", async () => {
    const thread = createThread({
      cwd: "/Users/reece/Desktop/Abitat_Workspace",
      id: "thread_a",
      turns: [
        createTurn({
          completedAt: 1_775_000_006,
          id: "turn_a",
          items: [
            {
              content: [{ text: "Initial prompt", text_elements: [], type: "text" }],
              id: "item_user_a",
              type: "userMessage"
            },
            ...Array.from({ length: 10 }, (_, index) => ({
              aggregatedOutput: `runtime ${index}`,
              command: "pnpm test",
              commandActions: [],
              cwd: "/Users/reece/Desktop/Abitat_Workspace",
              durationMs: 10,
              exitCode: 0,
              id: `item_command_${index}`,
              processId: null,
              source: "localShell",
              status: "completed",
              type: "commandExecution" as const
            })),
            {
              id: "item_agent_a",
              memoryCitation: null,
              phase: null,
              text: "Initial reply",
              type: "agentMessage"
            }
          ],
          status: "completed"
        })
      ],
      updatedAt: 1_775_000_010
    });
    const client = createFakeClient([thread]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });
    const initialMessages = await service.listMessages(externalCodexConversationId("thread_a"), {
      includeRuntime: false
    });
    const staleCursor = Math.max(...initialMessages.map((message) => message.sequence));

    thread.turns[0] = createTurn({
      completedAt: 1_775_000_006,
      id: "turn_a",
      items: [
        {
          content: [{ text: "Initial prompt", text_elements: [], type: "text" }],
          id: "item_user_a",
          type: "userMessage"
        },
        {
          id: "item_agent_a",
          memoryCitation: null,
          phase: null,
          text: "Initial reply",
          type: "agentMessage"
        }
      ],
      status: "completed"
    });
    thread.turns.push(
      createTurn({
        completedAt: 1_775_000_020,
        id: "turn_b",
        items: [
          {
            content: [{ text: "Desktop prompt after compaction", text_elements: [], type: "text" }],
            id: "item_user_b",
            type: "userMessage"
          },
          {
            id: "item_agent_b",
            memoryCitation: null,
            phase: null,
            text: "Desktop reply after compaction",
            type: "agentMessage"
          }
        ],
        status: "completed"
      })
    );
    thread.updatedAt = 1_775_000_030;

    const messages = await service.listMessages(externalCodexConversationId("thread_a"), {
      afterSequence: staleCursor,
      includeRuntime: false
    });

    expect(messages.map((message) => message.content)).toContain("Desktop prompt after compaction");
    expect(messages.map((message) => message.content)).toContain("Desktop reply after compaction");
  });

  it("keeps Codex message ids stable when runtime messages before them disappear", async () => {
    const thread = createThread({
      cwd: "/Users/reece/Desktop/Abitat_Workspace",
      id: "thread_a",
      turns: [
        createTurn({
          completedAt: 1_775_000_006,
          id: "turn_a",
          items: [
            {
              content: [{ text: "Initial prompt", text_elements: [], type: "text" }],
              id: "item_user_a",
              type: "userMessage"
            },
            {
              aggregatedOutput: "runtime output",
              command: "pnpm test",
              commandActions: [],
              cwd: "/Users/reece/Desktop/Abitat_Workspace",
              durationMs: 10,
              exitCode: 0,
              id: "item_command",
              processId: null,
              source: "localShell",
              status: "completed",
              type: "commandExecution"
            },
            {
              id: "item_agent_a",
              memoryCitation: null,
              phase: null,
              text: "Initial reply",
              type: "agentMessage"
            }
          ],
          status: "completed"
        })
      ],
      updatedAt: 1_775_000_010
    });
    const client = createFakeClient([thread]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });
    const initialMessages = await service.listMessages(externalCodexConversationId("thread_a"), {
      includeRuntime: false
    });

    thread.turns[0] = createTurn({
      completedAt: 1_775_000_006,
      id: "turn_a",
      items: [
        {
          content: [{ text: "Initial prompt", text_elements: [], type: "text" }],
          id: "item_user_a",
          type: "userMessage"
        },
        {
          id: "item_agent_a",
          memoryCitation: null,
          phase: null,
          text: "Initial reply",
          type: "agentMessage"
        }
      ],
      status: "completed"
    });
    thread.updatedAt = 1_775_000_030;

    const compactedMessages = await service.listMessages(externalCodexConversationId("thread_a"), {
      includeRuntime: false
    });

    expect(compactedMessages.find((message) => message.content === "Initial reply")?.id).toBe(
      initialMessages.find((message) => message.content === "Initial reply")?.id
    );
  });

  it("refreshes Codex messages from idle threads even when summary metadata does not change", async () => {
    const thread = createThread({
      cwd: "/Users/reece/Desktop/Abitat_Workspace",
      id: "thread_a",
      turns: [
        createTurn({
          completedAt: 1_775_000_006,
          id: "turn_a",
          items: [
            {
              content: [{ text: "Initial desktop prompt", text_elements: [], type: "text" }],
              id: "item_user_a",
              type: "userMessage"
            },
            {
              id: "item_agent_a",
              memoryCitation: null,
              phase: null,
              text: "Initial desktop reply",
              type: "agentMessage"
            }
          ],
          status: "completed"
        })
      ],
      updatedAt: 1_775_000_010
    });
    const client = createFakeClient([thread]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await service.listMessages(externalCodexConversationId("thread_a"), {
      includeRuntime: false
    });
    thread.turns.push(
      createTurn({
        completedAt: 1_775_000_020,
        id: "turn_b",
        items: [
          {
            content: [
              { text: "Desktop prompt after cached idle state", text_elements: [], type: "text" }
            ],
            id: "item_user_b",
            type: "userMessage"
          },
          {
            id: "item_agent_b",
            memoryCitation: null,
            phase: null,
            text: "Desktop reply after cached idle state",
            type: "agentMessage"
          }
        ],
        status: "completed"
      })
    );

    const incrementalMessages = await service.listMessages(
      externalCodexConversationId("thread_a"),
      {
        afterSequence: 2,
        includeRuntime: false
      }
    );
    const fullMessages = await service.listMessages(externalCodexConversationId("thread_a"), {
      includeRuntime: false
    });

    expect(incrementalMessages.map((message) => message.content)).toEqual([
      "Desktop prompt after cached idle state",
      "Desktop reply after cached idle state"
    ]);
    expect(fullMessages.map((message) => message.content)).toContain(
      "Desktop prompt after cached idle state"
    );
  });

  it("reads fresh Codex history when polling for messages", async () => {
    const client = createFakeClient([
      createThread({
        cwd: "/Users/reece/Desktop/Abitat_Workspace",
        id: "thread_a",
        turns: [
          {
            completedAt: 1_775_000_006,
            durationMs: 1000,
            error: null,
            id: "turn_a",
            items: [
              {
                content: [
                  { text: "Can you inspect this project?", text_elements: [], type: "text" }
                ],
                id: "item_user",
                type: "userMessage"
              },
              {
                id: "item_agent",
                memoryCitation: null,
                phase: null,
                text: "I will inspect the project structure.",
                type: "agentMessage"
              }
            ],
            startedAt: 1_775_000_005,
            status: { type: "completed" }
          }
        ]
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await service.listMessages(externalCodexConversationId("thread_a"));
    await service.listMessages(externalCodexConversationId("thread_a"), { afterSequence: 1 });

    expect(client.readThreadRequests).toEqual([
      { includeTurns: true, threadId: "thread_a" },
      { includeTurns: true, threadId: "thread_a" }
    ]);
  });

  it("updates cached Codex messages from background completion reads", async () => {
    const thread = createThread({
      cwd: "/Users/reece/Desktop/Abitat_Workspace",
      id: "thread_a",
      turns: [
        createTurn({
          completedAt: 1_775_000_006,
          id: "turn_a",
          items: [
            {
              content: [{ text: "Initial desktop message", text_elements: [], type: "text" }],
              id: "item_user_a",
              type: "userMessage"
            },
            {
              id: "item_agent_a",
              memoryCitation: null,
              phase: null,
              text: "Initial assistant reply",
              type: "agentMessage"
            }
          ],
          status: "completed"
        })
      ],
      updatedAt: 1_775_000_010
    });
    const client = createFakeClient([thread]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await service.listMessages(externalCodexConversationId("thread_a"));
    thread.turns.push(
      createTurn({
        completedAt: 1_775_000_020,
        id: "turn_b",
        items: [
          {
            content: [
              { text: "Desktop message after phone opened", text_elements: [], type: "text" }
            ],
            id: "item_user_b",
            type: "userMessage"
          },
          {
            id: "item_agent_b",
            memoryCitation: null,
            phase: null,
            text: "Desktop reply after phone opened",
            type: "agentMessage"
          }
        ],
        status: "completed"
      })
    );

    await service.listCompletionStates();
    const messages = await service.listMessages(externalCodexConversationId("thread_a"), {
      afterSequence: 2,
      includeRuntime: false
    });

    expect(messages.map((message) => message.content)).toEqual([
      "Desktop message after phone opened",
      "Desktop reply after phone opened"
    ]);
  });

  it("updates cached Codex messages from active conversation status reads", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const thread = createThread({
      cwd,
      id: "thread_a",
      turns: [
        createTurn({
          completedAt: 1_775_000_006,
          id: "turn_a",
          items: [
            {
              content: [{ text: "Initial desktop message", text_elements: [], type: "text" }],
              id: "item_user_a",
              type: "userMessage"
            },
            {
              id: "item_agent_a",
              memoryCitation: null,
              phase: null,
              text: "Initial assistant reply",
              type: "agentMessage"
            }
          ],
          status: "completed"
        })
      ],
      updatedAt: 1_775_000_010
    });
    const client = createFakeClient([thread]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await service.listMessages(externalCodexConversationId("thread_a"));
    thread.status = { type: "active", activeFlags: [] };
    thread.turns.push(
      createTurn({
        completedAt: null,
        id: "turn_b",
        items: [
          {
            content: [
              { text: "Desktop message after phone opened", text_elements: [], type: "text" }
            ],
            id: "item_user_b",
            type: "userMessage"
          }
        ],
        status: { type: "inProgress" }
      })
    );

    await service.listProjectConversations(externalCodexProjectId(cwd));
    const messages = await service.listMessages(externalCodexConversationId("thread_a"), {
      afterSequence: 2,
      includeRuntime: false
    });

    expect(messages.map((message) => message.content)).toEqual([
      "Desktop message after phone opened"
    ]);
  });

  it("refreshes cached Codex messages when a running thread completes without changing updatedAt", async () => {
    const thread = createThread({
      cwd: "/Users/reece/Desktop/Abitat_Workspace",
      id: "thread_a",
      status: { type: "active", activeFlags: [] },
      turns: [
        createTurn({
          completedAt: null,
          id: "turn_a",
          items: [
            {
              content: [{ text: "Phone prompt", text_elements: [], type: "text" }],
              id: "item_user_a",
              type: "userMessage"
            }
          ],
          status: { type: "inProgress" }
        })
      ],
      updatedAt: 1_775_000_010
    });
    const client = createFakeClient([thread]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await service.listMessages(externalCodexConversationId("thread_a"));
    thread.status = { type: "idle" };
    thread.turns[0] = createTurn({
      completedAt: 1_775_000_020,
      id: "turn_a",
      items: [
        {
          content: [{ text: "Phone prompt", text_elements: [], type: "text" }],
          id: "item_user_a",
          type: "userMessage"
        },
        {
          id: "item_agent_a",
          memoryCitation: null,
          phase: null,
          text: "Reply that should appear immediately",
          type: "agentMessage"
        }
      ],
      status: "completed"
    });

    const messages = await service.listMessages(externalCodexConversationId("thread_a"), {
      afterSequence: 1,
      includeRuntime: false
    });

    expect(messages.map((message) => message.content)).toEqual([
      "Reply that should appear immediately"
    ]);
  });

  it("reports Codex completion state only after the latest turn is finished", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_running",
        preview: "Running with partial answer",
        status: { type: "active", activeFlags: [] },
        turns: [
          {
            completedAt: null,
            durationMs: null,
            error: null,
            id: "turn_running",
            items: [
              {
                id: "item_agent",
                memoryCitation: null,
                phase: null,
                text: "Partial response while still coding.",
                type: "agentMessage"
              }
            ],
            startedAt: 1_775_000_020,
            status: { type: "inProgress" }
          }
        ]
      }),
      createThread({
        cwd,
        id: "thread_done",
        preview: "Finished",
        status: { type: "idle" },
        turns: [
          {
            completedAt: 1_775_000_050,
            durationMs: 1000,
            error: null,
            id: "turn_done",
            items: [
              {
                id: "item_agent",
                memoryCitation: null,
                phase: null,
                text: "Finished.",
                type: "agentMessage"
              }
            ],
            startedAt: 1_775_000_040,
            status: { type: "completed" }
          }
        ],
        updatedAt: 1_775_000_050
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const states = await service.listCompletionStates();

    expect(states).toEqual([
      expect.objectContaining({
        conversationId: externalCodexConversationId("thread_done"),
        isComplete: true,
        latestTurnCompletedAt: "2026-03-31T23:34:10.000Z",
        latestTurnId: "turn_done",
        status: "approved"
      }),
      expect.objectContaining({
        conversationId: externalCodexConversationId("thread_running"),
        isComplete: false,
        latestTurnCompletedAt: null,
        latestTurnId: "turn_running",
        status: "running"
      })
    ]);
  });

  it("reports active Codex turns waiting on approval instead of running", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_waiting",
        preview: "Waiting for approval",
        status: { type: "active", activeFlags: ["waitingOnApproval"] },
        turns: [
          {
            completedAt: null,
            durationMs: null,
            error: null,
            id: "turn_waiting",
            items: [
              {
                id: "item_agent",
                memoryCitation: null,
                phase: null,
                text: "I need approval before continuing.",
                type: "agentMessage"
              }
            ],
            startedAt: 1_775_000_020,
            status: { type: "inProgress" }
          }
        ]
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const [conversation] = await service.listProjectConversations(externalCodexProjectId(cwd));
    const [completion] = await service.listCompletionStates();

    expect(conversation).toEqual(
      expect.objectContaining({
        id: externalCodexConversationId("thread_waiting"),
        status: "awaiting_approval"
      })
    );
    expect(completion).toEqual(
      expect.objectContaining({
        conversationId: externalCodexConversationId("thread_waiting"),
        isComplete: false,
        latestTurnId: "turn_waiting",
        status: "awaiting_approval"
      })
    );
  });

  it("uses the thread update time when Codex marks a turn completed without completedAt", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_completed_without_timestamp",
        preview: "Finished without completedAt",
        status: { type: "idle" },
        turns: [
          {
            completedAt: null,
            durationMs: 1000,
            error: null,
            id: "turn_without_timestamp",
            items: [
              {
                id: "item_agent",
                memoryCitation: null,
                phase: null,
                text: "Finished.",
                type: "agentMessage"
              }
            ],
            startedAt: 1_775_000_040,
            status: "completed"
          }
        ],
        updatedAt: 1_775_000_050
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const states = await service.listCompletionStates();

    expect(states).toEqual([
      expect.objectContaining({
        conversationId: externalCodexConversationId("thread_completed_without_timestamp"),
        isComplete: true,
        latestTurnCompletedAt: "2026-03-31T23:34:10.000Z",
        latestTurnId: "turn_without_timestamp",
        status: "approved"
      })
    ]);
  });

  it("bounds pathological Codex message content and keeps duplicate item ids unique", async () => {
    const client = createFakeClient([
      createThread({
        createdAt: Number.NaN,
        cwd: "/Users/reece/Desktop/Abitat_Workspace",
        id: "thread_large",
        turns: [
          {
            completedAt: Number.NaN,
            durationMs: 1000,
            error: null,
            id: "turn_large",
            items: [
              {
                aggregatedOutput: "x".repeat(30_000),
                command: "pnpm test",
                commandActions: [],
                cwd: "/Users/reece/Desktop/Abitat_Workspace",
                durationMs: 10,
                exitCode: 0,
                id: "duplicate",
                processId: null,
                source: "localShell",
                status: "completed",
                type: "commandExecution"
              },
              {
                id: "duplicate",
                memoryCitation: null,
                phase: null,
                text: "second item",
                type: "agentMessage"
              }
            ],
            startedAt: Number.NaN,
            status: { type: "completed" }
          }
        ],
        updatedAt: Number.NaN
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const messages = await service.listMessages(externalCodexConversationId("thread_large"));

    expect(messages).toHaveLength(2);
    expect(messages[0]?.id).not.toBe(messages[1]?.id);
    expect(messages[0]?.content.length).toBeLessThan(12_500);
    expect(messages[0]?.content).toContain("output truncated");
    expect(Date.parse(messages[0]?.createdAt ?? "")).not.toBeNaN();
  });

  it("starts and continues Codex app turns through the app-server protocol", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([createThread({ cwd, id: "thread_a", preview: "Existing" })]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const created = await service.startConversation(externalCodexProjectId(cwd), {
      modelSettings: { effort: "high", model: "gpt-5.3-codex" },
      prompt: "Start from my phone"
    });
    const continued = await service.continueConversation(externalCodexConversationId("thread_a"), {
      modelSettings: { effort: "xhigh", model: "gpt-5.4-mini" },
      prompt: "Keep going from iPhone"
    });

    expect(created).toEqual({
      conversationId: externalCodexConversationId("thread_new"),
      status: "running"
    });
    expect(continued).toEqual({
      conversationId: externalCodexConversationId("thread_a"),
      status: "running"
    });
    expect(client.startedThreads).toEqual([cwd]);
    expect(client.resumedThreadRequests).toEqual([{ excludeTurns: false, threadId: "thread_a" }]);
    expect(client.startedTurns).toEqual([
      {
        approvalPolicy: "never",
        cwd,
        effort: "high",
        input: "Start from my phone",
        model: "gpt-5.3-codex",
        sandboxPolicy: { type: "dangerFullAccess" },
        threadId: "thread_new"
      },
      {
        approvalPolicy: "never",
        cwd,
        effort: "xhigh",
        input: "Keep going from iPhone",
        model: "gpt-5.4-mini",
        sandboxPolicy: { type: "dangerFullAccess" },
        threadId: "thread_a"
      }
    ]);
  });

  it("lists Codex model options for mobile controls", async () => {
    const client = createFakeClient([]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await expect(service.listModelOptions()).resolves.toEqual([
      {
        defaultReasoningEffort: "medium",
        description: "Best for agentic coding.",
        displayName: "GPT-5.3 Codex",
        id: "gpt-5.3-codex",
        isDefault: true,
        supportedReasoningEfforts: ["minimal", "medium", "high", "xhigh"]
      },
      {
        defaultReasoningEffort: "low",
        description: "Fast coding model.",
        displayName: "GPT-5.4 Mini",
        id: "gpt-5.4-mini",
        isDefault: false,
        supportedReasoningEfforts: ["low", "medium"]
      }
    ]);
  });

  it("resumes not-loaded Codex app threads before continuing them", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient(
      [
        createThread({
          cwd,
          id: "thread_a",
          preview: "Existing",
          status: { type: "notLoaded" }
        })
      ],
      { rejectUnloadedTurns: true }
    );
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    const continued = await service.continueConversation(externalCodexConversationId("thread_a"), {
      prompt: "Keep going after loading"
    });

    expect(continued).toEqual({
      conversationId: externalCodexConversationId("thread_a"),
      status: "running"
    });
    expect(client.resumedThreads).toEqual(["thread_a"]);
    expect(client.resumedThreadRequests).toEqual([{ excludeTurns: false, threadId: "thread_a" }]);
    expect(client.startedTurns).toEqual([
      {
        approvalPolicy: "never",
        cwd,
        input: "Keep going after loading",
        sandboxPolicy: { type: "dangerFullAccess" },
        threadId: "thread_a"
      }
    ]);
  });

  it("injects persisted Mac turns into an already-loaded app-server thread before phone continuation", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient(
      [
        createThread({
          cwd,
          id: "thread_a",
          preview: "Existing",
          status: { type: "idle" },
          turns: [
            createTurn({
              id: "turn_bruce",
              items: [
                {
                  content: [
                    {
                      text: "Bruce birthday is 9th of March",
                      text_elements: [],
                      type: "text"
                    }
                  ],
                  id: "item_bruce_user",
                  type: "userMessage"
                },
                {
                  id: "item_bruce_agent",
                  memoryCitation: null,
                  phase: null,
                  text: "Bruce birthday is 9th of March",
                  type: "agentMessage"
                }
              ],
              status: "completed"
            }),
            createTurn({
              id: "turn_bryan",
              items: [
                {
                  content: [
                    {
                      text: "Bryan birthday is 9th of May",
                      text_elements: [],
                      type: "text"
                    }
                  ],
                  id: "item_bryan_user",
                  type: "userMessage"
                },
                {
                  id: "item_bryan_agent",
                  memoryCitation: null,
                  phase: null,
                  text: "Bryan birthday is 9th of May",
                  type: "agentMessage"
                }
              ],
              status: "completed"
            })
          ]
        })
      ],
      { loadedThreadIds: ["thread_a"] }
    );
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await service.continueConversation(externalCodexConversationId("thread_a"), {
      prompt: "How about Bryan?"
    });

    expect(client.injectedItems).toEqual([
      {
        items: [
          {
            content: [{ text: "Bruce birthday is 9th of March", type: "input_text" }],
            role: "user",
            type: "message"
          },
          {
            content: [{ text: "Bryan birthday is 9th of May", type: "input_text" }],
            role: "user",
            type: "message"
          }
        ],
        threadId: "thread_a"
      }
    ]);
    expect(client.operations).toEqual(["resume:thread_a", "inject:thread_a", "start:thread_a"]);
  });

  it("logs Codex app context sync injections for phone continuations", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const activityLog = createFakeActivityLog();
    const client = createFakeClient(
      [
        createThread({
          cwd,
          id: "thread_a",
          preview: "Existing",
          status: { type: "idle" },
          turns: [
            createTurn({
              id: "turn_mac",
              items: [
                {
                  content: [
                    {
                      text: "Bryan birthday is 9th of May",
                      text_elements: [],
                      type: "text"
                    }
                  ],
                  id: "item_mac_user",
                  type: "userMessage"
                }
              ],
              status: "completed"
            })
          ]
        })
      ],
      { loadedThreadIds: ["thread_a"] }
    );
    const service = createCodexAppService(client, {
      activityLog,
      workspaceId: "workspace_demo"
    });

    await service.continueConversation(externalCodexConversationId("thread_a"), {
      prompt: "How about Bryan?"
    });

    expect(activityLog.events).toContainEqual({
      details: {
        itemCount: 1,
        mode: "loaded_without_cursor",
        terminalTurnCount: 1,
        threadId: "thread_a",
        threadWasLoaded: true
      },
      event: "codex_app_context_sync_injected"
    });
  });

  it("injects only turns persisted after the last phone-started Codex turn when tracked", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const loadedThreadIds: string[] = [];
    const thread = createThread({
      cwd,
      id: "thread_a",
      preview: "Existing",
      status: { type: "idle" },
      turns: [
        createTurn({
          id: "turn_intro",
          items: [
            {
              content: [
                { text: "Bruce birthday is 9th of March", text_elements: [], type: "text" }
              ],
              id: "item_intro_user",
              type: "userMessage"
            }
          ],
          status: "completed"
        })
      ]
    });
    const client = createFakeClient([thread], {
      loadedThreadIds,
      startTurnIds: ["turn_phone", "turn_after_mac"]
    });
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await service.continueConversation(externalCodexConversationId("thread_a"), {
      prompt: "When is Bruce birthday?"
    });
    thread.turns.push(
      createTurn({
        id: "turn_phone",
        items: [],
        status: "completed"
      }),
      createTurn({
        id: "turn_mac",
        items: [
          {
            content: [{ text: "Bryan birthday is 9th of May", text_elements: [], type: "text" }],
            id: "item_mac_user",
            type: "userMessage"
          },
          {
            id: "item_mac_agent",
            memoryCitation: null,
            phase: null,
            text: "Bryan birthday is 9th of May",
            type: "agentMessage"
          }
        ],
        status: "completed"
      })
    );
    loadedThreadIds.push("thread_a");
    client.injectedItems.splice(0);
    client.operations.splice(0);

    await service.continueConversation(externalCodexConversationId("thread_a"), {
      prompt: "How about Bryan?"
    });

    expect(client.injectedItems).toEqual([
      {
        items: [
          {
            content: [{ text: "Bryan birthday is 9th of May", type: "input_text" }],
            role: "user",
            type: "message"
          },
          {
            content: [{ text: "Bryan birthday is 9th of May", type: "output_text" }],
            role: "assistant",
            type: "message"
          }
        ],
        threadId: "thread_a"
      }
    ]);
    expect(client.operations).toEqual(["resume:thread_a", "inject:thread_a", "start:thread_a"]);
  });

  it("rejects phone continuation while the Codex app thread is already running", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_active",
        preview: "Running on another device",
        status: { type: "active", activeFlags: [] },
        turns: [
          {
            completedAt: null,
            durationMs: null,
            error: null,
            id: "turn_active",
            items: [],
            startedAt: 1_775_000_040,
            status: { type: "inProgress" }
          }
        ]
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await expect(
      service.continueConversation(externalCodexConversationId("thread_active"), {
        prompt: "Keep going while active"
      })
    ).rejects.toThrow(CodexConversationBusyError);
    expect(client.startedTurns).toEqual([]);
  });

  it("normalizes app-server busy races when another device starts a Codex turn first", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient(
      [
        createThread({
          cwd,
          id: "thread_race",
          preview: "Existing",
          status: { type: "idle" }
        })
      ],
      { startTurnError: new Error("thread is already running") }
    );
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    let caught: unknown;
    try {
      await service.continueConversation(externalCodexConversationId("thread_race"), {
        prompt: "Keep going after a race"
      });
    } catch (error) {
      caught = error;
    }

    expect(isCodexConversationBusyError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(CodexConversationBusyError);
    expect(caught).toHaveProperty("statusCode", 409);
  });

  it("rejects phone continuation while the Codex app thread is waiting on approval", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_review",
        preview: "Existing",
        status: { activeFlags: ["waitingOnApproval"], type: "active" },
        turns: [
          createTurn({
            id: "turn_review",
            items: [],
            status: "inProgress"
          })
        ]
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    let caught: unknown;
    try {
      await service.continueConversation(externalCodexConversationId("thread_review"), {
        prompt: "Please continue during review"
      });
    } catch (error) {
      caught = error;
    }

    expect(isCodexConversationBusyError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(CodexConversationBusyError);
    expect(client.startedTurns).toEqual([]);
  });

  it("recovers continuation when a Codex app thread is in system error", async () => {
    const cwd = "/Users/reece/Desktop/Abitat_Workspace";
    const client = createFakeClient([
      createThread({
        cwd,
        id: "thread_a",
        preview: "Existing",
        status: { type: "systemError" }
      })
    ]);
    const service = createCodexAppService(client, { workspaceId: "workspace_demo" });

    await expect(
      service.continueConversation(externalCodexConversationId("thread_a"), {
        prompt: "Keep going"
      })
    ).resolves.toEqual({
      conversationId: externalCodexConversationId("thread_a"),
      status: "running"
    });
    expect(client.operations).toEqual(["resume:thread_a", "start:thread_a"]);
  });

  it("marks Codex external identifiers and desktop app deep links", () => {
    const threadId = "019e01b0-7d24-72e0-8de8-ce2c8c6a55c0";

    expect(isCodexProjectId(externalCodexProjectId("/tmp/example"))).toBe(true);
    expect(isCodexConversationId(externalCodexConversationId(threadId))).toBe(true);
    expect(toCodexThreadId(externalCodexConversationId(threadId))).toBe(threadId);
    expect(codexAppDeepLink(threadId)).toBe(`codex://threads/${threadId}`);
  });
});
