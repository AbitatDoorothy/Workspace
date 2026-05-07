import { describe, expect, it } from "vitest";

import {
  codexAppDeepLink,
  createCodexAppService,
  externalCodexConversationId,
  externalCodexProjectId,
  isCodexConversationId,
  isCodexProjectId,
  toCodexThreadId,
  type CodexAppClient,
  type CodexAppThread
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

interface FakeCodexAppClient extends CodexAppClient {
  resumedThreads: string[];
  startedTurns: Array<{ threadId: string; cwd?: string | null; input: string }>;
  startedThreads: string[];
  resumeThread(params: {
    threadId: string;
    excludeTurns?: boolean;
  }): Promise<{ thread: CodexAppThread }>;
}

function createFakeClient(
  threads: CodexAppThread[],
  clientOptions: { rejectUnloadedTurns?: boolean } = {}
): FakeCodexAppClient {
  const resumedThreads: string[] = [];
  const startedTurns: Array<{ threadId: string; cwd?: string | null; input: string }> = [];
  const startedThreads: string[] = [];

  return {
    resumedThreads,
    startedThreads,
    startedTurns,
    async listThreads(params = {}) {
      const cwd = Array.isArray(params.cwd) ? params.cwd[0] : params.cwd;
      return {
        backwardsCursor: null,
        data: cwd ? threads.filter((thread) => thread.cwd === cwd) : threads,
        nextCursor: null
      };
    },
    async readThread(threadId) {
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
      resumedThreads.push(params.threadId);
      return { thread };
    },
    async startTurn(threadId, input, options) {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (clientOptions.rejectUnloadedTurns && thread?.status.type === "notLoaded") {
        throw new Error(`thread not found: ${threadId}`);
      }

      const text = input
        .filter((item): item is { type: "text"; text: string; text_elements: [] } => {
          return item.type === "text";
        })
        .map((item) => item.text)
        .join("\n");

      startedTurns.push({ cwd: options?.cwd, input: text, threadId });
      return {
        turn: {
          completedAt: null,
          durationMs: null,
          error: null,
          id: "turn_new",
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
      prompt: "Start from my phone"
    });
    const continued = await service.continueConversation(externalCodexConversationId("thread_a"), {
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
    expect(client.startedTurns).toEqual([
      { cwd, input: "Start from my phone", threadId: "thread_new" },
      { cwd, input: "Keep going from iPhone", threadId: "thread_a" }
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
    expect(client.startedTurns).toEqual([
      { cwd, input: "Keep going after loading", threadId: "thread_a" }
    ]);
  });

  it("rejects continuation when a Codex app thread is in system error", async () => {
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
    ).rejects.toThrow("Codex app thread is in a system error state");
    expect(client.startedTurns).toEqual([]);
  });

  it("marks Codex external identifiers and deep links", () => {
    expect(isCodexProjectId(externalCodexProjectId("/tmp/example"))).toBe(true);
    expect(isCodexConversationId(externalCodexConversationId("thread_a"))).toBe(true);
    expect(toCodexThreadId(externalCodexConversationId("thread_a"))).toBe("thread_a");
    expect(codexAppDeepLink("thread_a")).toBe("codex://local/thread_a");
  });
});
