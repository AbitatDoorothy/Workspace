"use client";

import { useEffect, useState } from "react";

import { toChatMessages, type RunEventView } from "./chat-events";

interface ConversationEventsProps {
  conversationId: string;
  initialEvents: RunEventView[];
  savedPrompt?: string;
}

export function ConversationEvents({
  conversationId,
  initialEvents,
  savedPrompt
}: ConversationEventsProps) {
  const [events, setEvents] = useState(initialEvents);

  useEffect(() => {
    const source = new EventSource(`/api/conversations/${conversationId}/events/stream`);

    source.addEventListener("run-event", (message) => {
      const event = JSON.parse((message as MessageEvent).data) as RunEventView;
      setEvents((current) =>
        current.some((existing) => existing.sequence === event.sequence)
          ? current
          : [...current, event].sort((left, right) => left.sequence - right.sequence)
      );
    });

    return () => {
      source.close();
    };
  }, [conversationId]);

  const messages = toChatMessages(events, savedPrompt);

  if (messages.length === 0) {
    return null;
  }

  return (
    <ol className="chat-thread" aria-label="Conversation messages">
      {messages.map((message) => (
        <li className={`chat-message chat-message-${message.side}`} key={message.id}>
          <p className="chat-bubble">{message.content}</p>
        </li>
      ))}
    </ol>
  );
}
