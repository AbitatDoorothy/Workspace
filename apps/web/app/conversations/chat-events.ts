import type { RunEventType } from "@abitat/shared";

export interface RunEventView {
  id: string;
  conversationId: string;
  sequence: number;
  type: RunEventType;
  content: string;
  metadataJson?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  side: "user" | "agent";
  content: string;
  sequence: number;
}

export function toChatMessages(events: RunEventView[], savedPrompt?: string): ChatMessage[] {
  const sortedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  const messages = sortedEvents.flatMap(toChatMessage);
  const hasUserMessage = messages.some((message) => message.side === "user");
  const trimmedSavedPrompt = savedPrompt?.trim();

  if (!hasUserMessage && trimmedSavedPrompt) {
    return [
      {
        id: "conversation-prompt",
        side: "user",
        content: trimmedSavedPrompt,
        sequence: 0
      },
      ...messages
    ];
  }

  return messages;
}

function toChatMessage(event: RunEventView): ChatMessage[] {
  const content = event.content.trim();

  if (!content) {
    return [];
  }

  if (isUserPromptEvent(event)) {
    return [
      {
        id: event.id,
        side: "user",
        content,
        sequence: event.sequence
      }
    ];
  }

  if (event.type === "stdout" || event.type === "summary") {
    return [
      {
        id: event.id,
        side: "agent",
        content,
        sequence: event.sequence
      }
    ];
  }

  return [];
}

function isUserPromptEvent(event: RunEventView) {
  return event.type === "approval" && event.metadataJson?.role === "user";
}
