import { describe, expect, it } from "vitest";

import {
  activeCompletionCount,
  formatBytes,
  formatTokenCount,
  messagePreview,
  sortConversations,
  sortProjects,
  statusTone
} from "../src/renderer/view-model";

describe("desktop view model helpers", () => {
  it("maps Codex statuses to compact desktop tones", () => {
    expect(statusTone("running")).toBe("running");
    expect(statusTone("queued")).toBe("running");
    expect(statusTone("pushed")).toBe("success");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("draft")).toBe("idle");
    expect(statusTone("preparing")).toBe("warning");
  });

  it("sorts projects and conversations by newest activity first", () => {
    expect(
      sortProjects([
        project("old", "2026-05-26T12:00:00.000Z"),
        project("new", "2026-05-27T12:00:00.000Z")
      ]).map((item) => item.id)
    ).toEqual(["new", "old"]);

    expect(
      sortConversations([
        conversation("old", "2026-05-26T12:00:00.000Z"),
        conversation("new", "2026-05-27T12:00:00.000Z")
      ]).map((item) => item.id)
    ).toEqual(["new", "old"]);
  });

  it("counts active completions and formats operational values", () => {
    expect(
      activeCompletionCount([
        completion("thread-a", "running"),
        completion("thread-b", "queued"),
        completion("thread-c", "approved")
      ])
    ).toBe(2);
    expect(formatTokenCount(1234567)).toBe("1,234,567");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("compacts message previews without changing short messages", () => {
    expect(messagePreview(message("short", "hello world"), 20)).toBe("hello world");
    expect(messagePreview(message("long", "one\n\n two   three four"), 14)).toBe("one two three...");
  });
});

function project(id: string, updatedAt: string) {
  return {
    conversationCount: 0,
    createdByUserId: "local",
    hostLocalPath: `/tmp/${id}`,
    id,
    name: id,
    repoSyncStatus: "codex_app" as const,
    repoUrl: `/tmp/${id}`,
    source: "codex_app" as const,
    updatedAt,
    workspaceId: "local"
  };
}

function conversation(id: string, updatedAt: string) {
  return {
    id,
    projectId: "project",
    prompt: id,
    source: "codex_app" as const,
    status: "approved",
    type: "codex_app",
    updatedAt,
    workspaceId: "local"
  };
}

function completion(conversationId: string, status: string) {
  return {
    conversationId,
    failed: false,
    isComplete: !["running", "queued"].includes(status),
    latestTurnCompletedAt: null,
    latestTurnId: null,
    projectId: "project",
    prompt: conversationId,
    source: "codex_app" as const,
    status,
    updatedAt: "2026-05-27T12:00:00.000Z",
    workspaceId: "local"
  };
}

function message(id: string, content: string) {
  return {
    content,
    conversationId: "thread",
    createdAt: "2026-05-27T12:00:00.000Z",
    id,
    role: "assistant" as const,
    sequence: 1
  };
}
