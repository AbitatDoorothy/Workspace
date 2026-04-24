"use client";

import { useEffect, useState } from "react";
import type { RunEventType } from "@abitat/shared";

interface RunEventView {
  id: string;
  conversationId: string;
  sequence: number;
  type: RunEventType;
  content: string;
}

interface ConversationEventsProps {
  conversationId: string;
  initialEvents: RunEventView[];
}

export function ConversationEvents({ conversationId, initialEvents }: ConversationEventsProps) {
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

  if (events.length === 0) {
    return null;
  }

  return (
    <ol className="event-list">
      {events.map((event) => (
        <li key={event.id}>
          <span>{event.type}</span>
          <p>{event.content}</p>
        </li>
      ))}
    </ol>
  );
}
