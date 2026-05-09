import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as GET_MESSAGES } from "../app/api/mobile/conversations/[id]/messages/route";
import { POST as CONTINUE_CONVERSATION } from "../app/api/mobile/conversations/[id]/continue/route";
import { GET as GET_PROJECTS } from "../app/api/mobile/projects/route";

const actor = vi.hoisted(() => ({
  hostMachineId: "machine_friend",
  machineId: "machine_phone_friend",
  userId: "user_friend",
  workspaceId: "workspace_friend"
}));

const listCodexProjects = vi.hoisted(() =>
  vi.fn(async () => [
    {
      conversationCount: 1,
      createdByUserId: "user_demo",
      hostLocalPath: "/Users/reece/Desktop/Abitat_Workspace",
      id: "codex_project_reece",
      name: "Abitat Workspace",
      repoSyncStatus: "codex_app",
      repoUrl: "/Users/reece/Desktop/Abitat_Workspace",
      source: "codex_app",
      updatedAt: "2026-05-08T13:24:59.000Z",
      workspaceId: "workspace_demo"
    }
  ])
);
const listCodexMessages = vi.hoisted(() =>
  vi.fn(async () => [
    {
      content: "Private desktop message",
      conversationId: "codex_thread_reece",
      createdAt: "2026-05-08T13:24:59.000Z",
      id: "message_1",
      metadata: {},
      role: "assistant",
      sequence: 1,
      sourceDeviceId: null
    }
  ])
);
const continueCodexConversation = vi.hoisted(() =>
  vi.fn(async () => ({
    conversationId: "codex_thread_reece",
    status: "running"
  }))
);
const listLocalProjects = vi.hoisted(() =>
  vi.fn(async () => [
    {
      createdByUserId: "user_friend",
      hostLocalPath: "/Users/friend/Project",
      id: "project_friend",
      name: "Friend Project",
      repoSyncStatus: "ready",
      repoUrl: "/Users/friend/Project",
      workspaceId: "workspace_friend"
    }
  ])
);
const hostSnapshot = vi.hoisted(() => ({
  getConversation: vi.fn(async () => null),
  getProject: vi.fn(async () => null),
  listCompletionStates: vi.fn(async () => []),
  listMessages: vi.fn(async () => []),
  listModelOptions: vi.fn(async () => []),
  listProjectConversations: vi.fn(async () => []),
  listProjects: vi.fn(async () => [])
}));

vi.mock("../server/codex-app", () => ({
  codexAppService: {
    continueConversation: continueCodexConversation,
    listMessages: listCodexMessages,
    listProjects: listCodexProjects
  },
  isCodexConversationBusyError: () => false,
  isCodexConversationId: (id: string) => id.startsWith("codex_thread_"),
  isCodexProjectId: (id: string) => id.startsWith("codex_project_")
}));

vi.mock("../server/mobile", () => ({
  mobileService: {
    listProjects: listLocalProjects
  }
}));

vi.mock("../server/hosts", () => ({
  hostCodexSnapshotService: hostSnapshot
}));

vi.mock("../server/mobile/request-auth", () => ({
  requireMobileActor: vi.fn(async () => actor)
}));

vi.mock("../server/mobile/mobile-activity-log", () => ({
  mobileActivityLog: {
    record: vi.fn()
  }
}));

vi.mock("../server/conversation-messages", () => ({
  conversationMessageService: {
    appendMessage: vi.fn(),
    listMessages: vi.fn(async () => [])
  }
}));

vi.mock("../server/conversations", () => ({
  conversationQueueService: {
    continueConversation: vi.fn(),
    listConversations: vi.fn(async () => [])
  }
}));

vi.mock("../server/run-events", () => ({
  runEventService: {
    appendAuditEvent: vi.fn(),
    listEvents: vi.fn(async () => [])
  }
}));

describe("mobile Codex host scoping", () => {
  beforeEach(() => {
    actor.hostMachineId = "machine_friend";
    actor.machineId = "machine_phone_friend";
    actor.userId = "user_friend";
    actor.workspaceId = "workspace_friend";
    continueCodexConversation.mockClear();
    listCodexMessages.mockClear();
    listCodexProjects.mockClear();
    listLocalProjects.mockClear();
    Object.values(hostSnapshot).forEach((mock) => mock.mockClear());
    vi.stubEnv("ABITAT_ENABLE_LOCAL_CODEX_APP", "1");
    vi.stubEnv("ABITAT_MACHINE_ID", "machine_demo");
  });

  it("does not include this server's Codex projects for a phone paired to another host", async () => {
    const response = await GET_PROJECTS(
      new Request("http://127.0.0.1:3000/api/mobile/projects", {
        headers: { authorization: "Bearer client_friend" }
      })
    );

    await expect(response.json()).resolves.toEqual({
      projects: [
        {
          createdByUserId: "user_friend",
          hostLocalPath: "/Users/friend/Project",
          id: "project_friend",
          name: "Friend Project",
          repoSyncStatus: "ready",
          repoUrl: "/Users/friend/Project",
          workspaceId: "workspace_friend"
        }
      ]
    });
    expect(listCodexProjects).not.toHaveBeenCalled();
  });

  it("includes this Mac's Codex projects for the same local CLI user", async () => {
    actor.hostMachineId = "machine_registered";
    actor.machineId = "machine_phone_reece";
    actor.userId = "user_reece";
    actor.workspaceId = "workspace_reece";
    vi.stubEnv("ABITAT_LOCAL_CODEX_USER_ID", "user_reece");

    const response = await GET_PROJECTS(
      new Request("http://127.0.0.1:3000/api/mobile/projects", {
        headers: { authorization: "Bearer client_reece" }
      })
    );

    await expect(response.json()).resolves.toEqual({
      projects: [
        {
          conversationCount: 1,
          createdByUserId: "user_demo",
          hostLocalPath: "/Users/reece/Desktop/Abitat_Workspace",
          id: "codex_project_reece",
          name: "Abitat Workspace",
          repoSyncStatus: "codex_app",
          repoUrl: "/Users/reece/Desktop/Abitat_Workspace",
          source: "codex_app",
          updatedAt: "2026-05-08T13:24:59.000Z",
          workspaceId: "workspace_demo"
        },
        {
          createdByUserId: "user_friend",
          hostLocalPath: "/Users/friend/Project",
          id: "project_friend",
          name: "Friend Project",
          repoSyncStatus: "ready",
          repoUrl: "/Users/friend/Project",
          workspaceId: "workspace_friend"
        }
      ]
    });
    expect(listCodexProjects).toHaveBeenCalledTimes(1);
  });

  it("rejects reading a Codex thread when the phone is paired to another host", async () => {
    const response = await GET_MESSAGES(
      new Request("http://127.0.0.1:3000/api/mobile/conversations/codex_thread_reece/messages", {
        headers: { authorization: "Bearer client_friend" }
      }),
      { params: Promise.resolve({ id: "codex_thread_reece" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Conversation not found" });
    expect(listCodexMessages).not.toHaveBeenCalled();
  });

  it("rejects controlling a Codex thread when the phone is paired to another host", async () => {
    const response = await CONTINUE_CONVERSATION(
      new Request("http://127.0.0.1:3000/api/mobile/conversations/codex_thread_reece/continue", {
        body: JSON.stringify({ clientMessageId: "ios-1", prompt: "Hello from friend" }),
        headers: {
          authorization: "Bearer client_friend",
          "content-type": "application/json"
        },
        method: "POST"
      }),
      { params: Promise.resolve({ id: "codex_thread_reece" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Conversation not found" });
    expect(continueCodexConversation).not.toHaveBeenCalled();
  });
});
