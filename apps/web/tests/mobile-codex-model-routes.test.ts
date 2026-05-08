import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as GET_MODELS } from "../app/api/mobile/codex/models/route";
import { POST as CONTINUE_CONVERSATION } from "../app/api/mobile/conversations/[id]/continue/route";
import { POST as CREATE_CONVERSATION } from "../app/api/mobile/projects/[projectId]/conversations/route";

const listModelOptions = vi.hoisted(() =>
  vi.fn(async () => [
    {
      defaultReasoningEffort: "medium",
      description: "Best for agentic coding.",
      displayName: "GPT-5.3 Codex",
      id: "gpt-5.3-codex",
      isDefault: true,
      supportedReasoningEfforts: ["minimal", "medium", "high", "xhigh"]
    }
  ])
);
const startConversation = vi.hoisted(() =>
  vi.fn(async () => ({
    conversationId: "codex_thread_thread_new",
    status: "running"
  }))
);
const continueConversation = vi.hoisted(() =>
  vi.fn(async () => ({
    conversationId: "codex_thread_thread_1",
    status: "running"
  }))
);
const requireMobileActor = vi.hoisted(() =>
  vi.fn(async () => ({
    hostMachineId: "machine_host",
    machineId: "machine_phone",
    userId: "user_demo",
    workspaceId: "workspace_demo"
  }))
);

vi.mock("../server/codex-app", () => ({
  codexAppService: {
    continueConversation,
    listModelOptions,
    startConversation
  },
  isCodexConversationBusyError: () => false,
  isCodexConversationId: (id: string) => id.startsWith("codex_thread_"),
  isCodexProjectId: (id: string) => id.startsWith("codex_project_")
}));

vi.mock("../server/mobile/request-auth", () => ({
  requireMobileActor
}));

vi.mock("../server/mobile/mobile-activity-log", () => ({
  mobileActivityLog: {
    record: vi.fn()
  }
}));

vi.mock("../server/conversation-messages", () => ({
  conversationMessageService: {
    appendMessage: vi.fn()
  }
}));

vi.mock("../server/conversations", () => ({
  conversationQueueService: {
    createConversation: vi.fn(),
    continueConversation: vi.fn(),
    listConversations: vi.fn(async () => [])
  }
}));

vi.mock("../server/run-events", () => ({
  runEventService: {
    appendAuditEvent: vi.fn()
  }
}));

describe("mobile Codex model routes", () => {
  beforeEach(() => {
    continueConversation.mockClear();
    listModelOptions.mockClear();
    requireMobileActor.mockClear();
    startConversation.mockClear();
  });

  it("lists Codex model options for the iPhone app", async () => {
    const response = await GET_MODELS(
      new Request("http://127.0.0.1:3000/api/mobile/codex/models", {
        headers: { authorization: "Bearer client_secret" }
      })
    );

    await expect(response.json()).resolves.toEqual({
      models: [
        {
          defaultReasoningEffort: "medium",
          description: "Best for agentic coding.",
          displayName: "GPT-5.3 Codex",
          id: "gpt-5.3-codex",
          isDefault: true,
          supportedReasoningEfforts: ["minimal", "medium", "high", "xhigh"]
        }
      ]
    });
    expect(listModelOptions).toHaveBeenCalledTimes(1);
  });

  it("passes mobile model settings when starting Codex app conversations", async () => {
    const response = await CREATE_CONVERSATION(
      new Request("http://127.0.0.1:3000/api/mobile/projects/codex_project_demo/conversations", {
        body: JSON.stringify({
          attachments: [{ kind: "file", name: "notes.md", path: "/tmp/notes.md" }],
          clientMessageId: "ios-message-1",
          effort: "high",
          model: "gpt-5.3-codex",
          prompt: "Start from iPhone"
        }),
        headers: {
          authorization: "Bearer client_secret",
          "content-type": "application/json"
        },
        method: "POST"
      }),
      { params: Promise.resolve({ projectId: "codex_project_demo" }) }
    );

    expect(response.status).toBe(201);
    expect(startConversation).toHaveBeenCalledWith("codex_project_demo", {
      attachments: [{ kind: "file", name: "notes.md", path: "/tmp/notes.md" }],
      modelSettings: { effort: "high", model: "gpt-5.3-codex" },
      prompt: "Start from iPhone"
    });
  });

  it("passes mobile model settings when continuing Codex app conversations", async () => {
    const response = await CONTINUE_CONVERSATION(
      new Request("http://127.0.0.1:3000/api/mobile/conversations/codex_thread_thread_1/continue", {
        body: JSON.stringify({
          clientMessageId: "ios-message-2",
          effort: "xhigh",
          model: "gpt-5.4-mini",
          prompt: "Continue from iPhone"
        }),
        headers: {
          authorization: "Bearer client_secret",
          "content-type": "application/json"
        },
        method: "POST"
      }),
      { params: Promise.resolve({ id: "codex_thread_thread_1" }) }
    );

    expect(response.status).toBe(200);
    expect(continueConversation).toHaveBeenCalledWith("codex_thread_thread_1", {
      attachments: [],
      modelSettings: { effort: "xhigh", model: "gpt-5.4-mini" },
      prompt: "Continue from iPhone"
    });
  });
});
