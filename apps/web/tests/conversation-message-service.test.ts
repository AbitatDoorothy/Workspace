import { describe, expect, it } from "vitest";

import { createConversationMessageService } from "../server/conversation-messages/conversation-message-service";

interface TestMessage {
  id: string;
  conversationId: string;
  sequence: number;
  role: "user" | "assistant" | "system" | "runtime";
  sourceDeviceId?: string | null;
  clientMessageId?: string | null;
  content: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
}

function createMessageDb() {
  const messages: TestMessage[] = [];

  return {
    conversationMessage: {
      create: async ({ data }: { data: TestMessage }) => {
        messages.push(data);
        return data;
      },
      findFirst: async ({
        orderBy,
        where
      }: {
        orderBy?: { sequence: "desc" };
        where: Partial<TestMessage>;
      }) => {
        const matches = messages.filter((message) =>
          Object.entries(where).every(([key, value]) => message[key as keyof TestMessage] === value)
        );

        return orderBy?.sequence === "desc"
          ? (matches.sort((left, right) => right.sequence - left.sequence)[0] ?? null)
          : (matches[0] ?? null);
      },
      findMany: async ({
        where
      }: {
        where: { conversationId: string; sequence?: { gt: number } };
      }) =>
        messages
          .filter(
            (message) =>
              message.conversationId === where.conversationId &&
              (where.sequence ? message.sequence > where.sequence.gt : true)
          )
          .sort((left, right) => left.sequence - right.sequence)
    },
    state: { messages }
  };
}

describe("conversation message service", () => {
  it("appends messages with increasing per-conversation sequences", async () => {
    const db = createMessageDb();
    const service = createConversationMessageService(db, {
      idGenerator: () => "message_test",
      now: () => new Date("2026-05-03T10:00:00.000Z")
    });

    const first = await service.appendMessage("conversation_demo", {
      role: "user",
      sourceDeviceId: "machine_phone",
      content: "Start from the phone",
      metadata: { client: "ios" }
    });
    const second = await service.appendMessage("conversation_demo", {
      role: "assistant",
      content: "Codex is running"
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(await service.listMessages("conversation_demo")).toEqual([first, second]);
  });

  it("deduplicates client messages by clientMessageId", async () => {
    const db = createMessageDb();
    const service = createConversationMessageService(db);

    const first = await service.appendMessage("conversation_demo", {
      role: "user",
      sourceDeviceId: "machine_phone",
      clientMessageId: "local-1",
      content: "Continue"
    });
    const second = await service.appendMessage("conversation_demo", {
      role: "user",
      sourceDeviceId: "machine_phone",
      clientMessageId: "local-1",
      content: "Continue"
    });

    expect(second).toBe(first);
    expect(await service.listMessages("conversation_demo")).toHaveLength(1);
  });

  it("lists messages after a sequence cursor", async () => {
    const db = createMessageDb();
    const service = createConversationMessageService(db);

    await service.appendMessage("conversation_demo", { role: "user", content: "one" });
    const second = await service.appendMessage("conversation_demo", {
      role: "assistant",
      content: "two"
    });

    expect(await service.listMessages("conversation_demo", { afterSequence: 1 })).toEqual([second]);
  });
});
