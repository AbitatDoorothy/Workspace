import type { RunEventIngestRequest } from "@abitat/shared";
import { describe, expect, it } from "vitest";

import { runConversationRuntime } from "../src/cli/conversation-runtime";
import type { RuntimeAdapter } from "../src/runtime/adapter";

describe("conversation runtime", () => {
  it("keeps reading CLI output when event ingestion temporarily fails", async () => {
    const sessionId = "019dd468-13a8-7480-a3af-7398d8c06475";
    const ingested: RunEventIngestRequest[] = [];
    let ingestAttempts = 0;
    const adapter: RuntimeAdapter = {
      name: "codex",
      isAvailable: async () => ({ installed: true }),
      run: async (_input, emit) => {
        await emit({ type: "stdout", content: "Created diamond.md." });
        await emit({ type: "stdout", content: `session id: ${sessionId}` });
      }
    };

    const runtimeSessionId = await runConversationRuntime(
      {
        ingestRunEvent: async (_conversationId, input) => {
          ingestAttempts += 1;

          if (ingestAttempts === 1) {
            throw new Error("503 Local connector disconnected");
          }

          ingested.push(input);
        }
      },
      adapter,
      {
        allowedTools: [],
        conversationId: "conversation_test",
        instructions: "Use Codex.",
        prompt: "",
        worktreePath: "/tmp/worktree"
      },
      { eventIngestAttempts: 1 }
    );

    expect(runtimeSessionId).toBe(sessionId);
    expect(ingestAttempts).toBe(2);
    expect(ingested).toContainEqual({
      sequence: 2,
      type: "stdout",
      content: `session id: ${sessionId}`,
      metadata: {}
    });
  });

  it("retries summary ingestion before giving up", async () => {
    const ingested: RunEventIngestRequest[] = [];
    let summaryAttempts = 0;
    const adapter: RuntimeAdapter = {
      name: "codex",
      isAvailable: async () => ({ installed: true }),
      run: async (_input, emit) => {
        await emit({ type: "stdout", content: "Updated first-poem.md." });
      }
    };

    await runConversationRuntime(
      {
        ingestRunEvent: async (_conversationId, input) => {
          if (input.type === "summary") {
            summaryAttempts += 1;

            if (summaryAttempts === 1) {
              throw new Error("503 Local connector disconnected");
            }
          }

          ingested.push(input);
        }
      },
      adapter,
      {
        allowedTools: [],
        captureSummary: true,
        conversationId: "conversation_test",
        instructions: "Summarize the thread.",
        prompt: "Summarize what changed.",
        worktreePath: "/tmp/worktree"
      },
      { eventIngestRetryDelayMs: 0 }
    );

    expect(summaryAttempts).toBe(2);
    expect(ingested).toContainEqual({
      sequence: 2,
      type: "summary",
      content: "Updated first-poem.md.",
      metadata: { action: "summarize" }
    });
  });
});
