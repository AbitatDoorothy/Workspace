import { describe, expect, it } from "vitest";

import { createRunEventService } from "../server/run-events/run-event-service";

interface TestRunEvent {
  id: string;
  conversationId: string;
  sequence: number;
  type: "approval" | "status" | "stdout" | "stderr";
  content: string;
  metadataJson: Record<string, unknown>;
}

function createRunEventDb() {
  const events = new Map<string, TestRunEvent>();

  return {
    runEvent: {
      create: async ({ data }: { data: TestRunEvent }) => {
        events.set(data.id, data);
        return data;
      },
      findMany: async ({ where }: { where: { conversationId: string } }) =>
        Array.from(events.values())
          .filter((event) => event.conversationId === where.conversationId)
          .sort((left, right) => left.sequence - right.sequence)
    }
  };
}

describe("run event service", () => {
  it("persists and lists run events in sequence order", async () => {
    const service = createRunEventService(createRunEventDb());

    await service.ingestEvent("conversation_demo", {
      sequence: 2,
      type: "stdout",
      content: "Wrote file",
      metadata: {}
    });
    await service.ingestEvent("conversation_demo", {
      sequence: 1,
      type: "status",
      content: "Mock runtime starting",
      metadata: {}
    });

    expect(await service.listEvents("conversation_demo")).toMatchObject([
      { sequence: 1, type: "status", content: "Mock runtime starting" },
      { sequence: 2, type: "stdout", content: "Wrote file" }
    ]);
  });

  it("appends audit events after the latest persisted sequence", async () => {
    const service = createRunEventService(createRunEventDb());

    await service.ingestEvent("conversation_demo", {
      sequence: 4,
      type: "stdout",
      content: "existing",
      metadata: {}
    });
    await service.appendAuditEvent("conversation_demo", {
      content: "Conversation approved",
      metadata: { action: "approval" }
    });

    expect(await service.listEvents("conversation_demo")).toMatchObject([
      { sequence: 4, content: "existing" },
      { sequence: 5, type: "approval", content: "Conversation approved" }
    ]);
  });

  it("moves ingested runtime events after existing conversation events", async () => {
    const service = createRunEventService(createRunEventDb());

    await service.appendAuditEvent("conversation_demo", {
      content: "Conversation started",
      metadata: { action: "start" }
    });
    await service.ingestEvent("conversation_demo", {
      sequence: 1,
      type: "status",
      content: "Codex runtime starting",
      metadata: {}
    });

    expect(await service.listEvents("conversation_demo")).toMatchObject([
      { sequence: 1, type: "approval", content: "Conversation started" },
      { sequence: 2, type: "status", content: "Codex runtime starting" }
    ]);
  });
});
