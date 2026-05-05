import { describe, expect, it } from "vitest";

import {
  canStartConversationCardDrag,
  canOpenConversationSummary,
  canManageConversationCard,
  conversationCodexAppHref,
  createConversationDeleteRequest,
  createConversationDragPayload,
  conversationDropTarget,
  conversationLabelFromStatus,
  createConversationLabelRequest,
  parseConversationDragPayload
} from "../app/projects/conversation-board-model";

describe("conversation board model", () => {
  it("uses the target column as the new label when a card moves columns", () => {
    expect(conversationDropTarget("in_process", "complete")).toBe("complete");
    expect(conversationDropTarget("complete", "in_process")).toBe("in_process");
    expect(conversationDropTarget("complete", "complete")).toBeNull();
  });

  it("builds the label update request used by drag and drop", () => {
    expect(
      createConversationLabelRequest({
        conversationId: "conversation_demo",
        label: "complete",
        redirectTo: "/projects/project_demo",
        userId: "user_demo"
      })
    ).toEqual({
      body: JSON.stringify({
        label: "complete",
        redirectTo: "/projects/project_demo",
        userId: "user_demo"
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      url: "/api/conversations/conversation_demo/label"
    });
  });

  it("keeps pushed conversations in complete and all other statuses in process", () => {
    expect(conversationLabelFromStatus("pushed")).toBe("complete");
    expect(conversationLabelFromStatus("running")).toBe("in_process");
    expect(conversationLabelFromStatus("failed")).toBe("in_process");
  });

  it("only opens summary pages for completed conversations", () => {
    expect(canOpenConversationSummary("pushed")).toBe(true);
    expect(canOpenConversationSummary("running")).toBe(false);
    expect(canOpenConversationSummary("awaiting_approval")).toBe(false);
  });

  it("starts card drags from card chrome but not interactive controls", () => {
    expect(canStartConversationCardDrag("DIV")).toBe(true);
    expect(canStartConversationCardDrag("SPAN")).toBe(true);
    expect(canStartConversationCardDrag("BUTTON")).toBe(false);
    expect(canStartConversationCardDrag("A")).toBe(false);
    expect(canStartConversationCardDrag("SELECT")).toBe(false);
  });

  it("opens Codex app cards through the desktop app and keeps queue actions disabled", () => {
    expect(
      conversationCodexAppHref({
        runtimeSessionId: "thread_demo"
      })
    ).toBe("codex://threads/thread_demo");
    expect(
      canManageConversationCard({
        source: "codex_app"
      })
    ).toBe(false);
  });

  it("builds the delete request used by the card delete button", () => {
    expect(
      createConversationDeleteRequest({
        conversationId: "conversation_demo",
        redirectTo: "/projects/project_demo",
        userId: "user_demo"
      })
    ).toEqual({
      body: JSON.stringify({
        redirectTo: "/projects/project_demo",
        userId: "user_demo"
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      url: "/api/conversations/conversation_demo/delete"
    });
  });

  it("round-trips the native drag payload used by conversation cards", () => {
    const payload = createConversationDragPayload({
      conversationId: "conversation_demo",
      sourceLabel: "in_process"
    });

    expect(parseConversationDragPayload(payload)).toEqual({
      conversationId: "conversation_demo",
      sourceLabel: "in_process"
    });
  });

  it("ignores invalid native drag payloads", () => {
    expect(parseConversationDragPayload("")).toBeNull();
    expect(parseConversationDragPayload("{")).toBeNull();
    expect(parseConversationDragPayload(JSON.stringify({ conversationId: "" }))).toBeNull();
    expect(
      parseConversationDragPayload(
        JSON.stringify({ conversationId: "conversation_demo", sourceLabel: "later" })
      )
    ).toBeNull();
  });
});
