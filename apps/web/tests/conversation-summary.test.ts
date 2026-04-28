import { describe, expect, it } from "vitest";

import type { RunEventView } from "../app/conversations/chat-events";
import { getLatestConversationSummary } from "../app/conversations/conversation-summary";

describe("conversation summary", () => {
  it("returns the newest summary event and ignores noisy runtime output", () => {
    const events: RunEventView[] = [
      {
        id: "event_1",
        conversationId: "conversation_demo",
        sequence: 1,
        type: "stdout",
        content: "terminal output",
        metadataJson: {}
      },
      {
        id: "event_2",
        conversationId: "conversation_demo",
        sequence: 2,
        type: "summary",
        content: "First summary",
        metadataJson: {}
      },
      {
        id: "event_3",
        conversationId: "conversation_demo",
        sequence: 3,
        type: "summary",
        content: "Final summary",
        metadataJson: {}
      }
    ];

    expect(getLatestConversationSummary(events, "Stored summary")).toBe("Final summary");
  });

  it("falls back to the stored review summary", () => {
    expect(getLatestConversationSummary([], " Stored summary ")).toBe("Stored summary");
  });

  it("cleans previously saved terminal summaries before display", () => {
    const events: RunEventView[] = [
      {
        id: "event_1",
        conversationId: "conversation_demo",
        sequence: 1,
        type: "summary",
        content: [
          "Codex terminal session ended.",
          "",
          "Recent activity:",
          "- 1 nihao",
          "- 2 +hola",
          "- Updated nihao.md by appending hola. › Improve documentation gpt-5.4",
          "- To continue this session, run codex resume 019dd2a7"
        ].join("\n"),
        metadataJson: {}
      }
    ];

    expect(getLatestConversationSummary(events)).toBe(
      "Codex terminal session ended.\n\nRecent activity:\n- Updated nihao.md by appending hola."
    );
  });
});
