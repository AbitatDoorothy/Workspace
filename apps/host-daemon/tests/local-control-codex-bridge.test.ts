import { describe, expect, it } from "vitest";

import { flattenThreadMessages } from "../src/local-control/codex-bridge";
import type { MobileControlDiagnosticsLogger } from "../src/local-control/diagnostics-log";

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
