import { describe, expect, it } from "vitest";

import { toChatMessages, type RunEventView } from "../app/conversations/chat-events";

describe("conversation chat events", () => {
  it("shows user prompts and agent replies while hiding runtime events", () => {
    const events: RunEventView[] = [
      {
        id: "event_1",
        conversationId: "conversation_demo",
        sequence: 1,
        type: "approval",
        content: "Create a markdown file.",
        metadataJson: { action: "start", role: "user" }
      },
      {
        id: "event_2",
        conversationId: "conversation_demo",
        sequence: 2,
        type: "stderr",
        content: "tokens used",
        metadataJson: {}
      },
      {
        id: "event_3",
        conversationId: "conversation_demo",
        sequence: 3,
        type: "status",
        content: "codex runtime completed",
        metadataJson: {}
      },
      {
        id: "event_4",
        conversationId: "conversation_demo",
        sequence: 4,
        type: "stdout",
        content: "Created success.md with the requested note.",
        metadataJson: {}
      }
    ];

    expect(toChatMessages(events)).toEqual([
      {
        id: "event_1",
        side: "user",
        content: "Create a markdown file.",
        sequence: 1
      },
      {
        id: "event_4",
        side: "agent",
        content: "Created success.md with the requested note.",
        sequence: 4
      }
    ]);
  });

  it("uses the saved conversation prompt for older conversations without prompt events", () => {
    const events: RunEventView[] = [
      {
        id: "event_1",
        conversationId: "conversation_demo",
        sequence: 1,
        type: "approval",
        content: "Conversation started",
        metadataJson: { action: "start" }
      },
      {
        id: "event_2",
        conversationId: "conversation_demo",
        sequence: 2,
        type: "stdout",
        content: "Created the page.",
        metadataJson: {}
      }
    ];

    expect(toChatMessages(events, "Add a useful page.")).toEqual([
      {
        id: "conversation-prompt",
        side: "user",
        content: "Add a useful page.",
        sequence: 0
      },
      {
        id: "event_2",
        side: "agent",
        content: "Created the page.",
        sequence: 2
      }
    ]);
  });

  it("shows terminal session summaries as agent messages", () => {
    const events: RunEventView[] = [
      {
        id: "event_1",
        conversationId: "conversation_demo",
        sequence: 1,
        type: "summary",
        content: "Codex terminal session ended.\n\nRecent activity:\n- Created hello.md.",
        metadataJson: {}
      }
    ];

    expect(toChatMessages(events)).toEqual([
      {
        id: "event_1",
        side: "agent",
        content: "Codex terminal session ended.\n\nRecent activity:\n- Created hello.md.",
        sequence: 1
      }
    ]);
  });
});
