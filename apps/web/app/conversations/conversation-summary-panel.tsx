"use client";

import { useEffect, useState } from "react";

import type { RunEventView } from "./chat-events";
import { getLatestConversationSummary } from "./conversation-summary";

interface ConversationSummaryPanelProps {
  conversationId: string;
  initialEvents: RunEventView[];
  savedSummary?: string | null;
}

export function ConversationSummaryPanel({
  conversationId,
  initialEvents,
  savedSummary
}: ConversationSummaryPanelProps) {
  const [events, setEvents] = useState(initialEvents);
  const summary = getLatestConversationSummary(events, savedSummary);

  useEffect(() => {
    const source = new EventSource(`/api/conversations/${conversationId}/events/stream`);

    source.addEventListener("run-event", (message) => {
      const event = JSON.parse((message as MessageEvent).data) as RunEventView;

      if (event.type !== "summary") {
        return;
      }

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

  return (
    <article className="conversation-summary-panel" aria-live="polite">
      <h1>Summary</h1>
      {summary ? (
        <div className="conversation-summary-copy">{summary}</div>
      ) : (
        <p className="conversation-summary-empty">
          Summary will appear here when the terminal session exits.
        </p>
      )}
    </article>
  );
}
