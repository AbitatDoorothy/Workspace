"use client";

import { useEffect, useRef, useState } from "react";

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
  const bodyRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [events]);

  const messages = toChatMessages(events, savedPrompt);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="terminal-pane">
      <div className="terminal-pane-header">
        <span className="terminal-pane-dot" />
        <span className="terminal-pane-dot" />
        <span className="terminal-pane-dot" />
        <span className="terminal-pane-title">conversation — {conversationId}</span>
      </div>
      <div className="terminal-pane-body" ref={bodyRef}>
        {messages.map((message) =>
          message.side === "user" ? (
            <div className="terminal-prompt-line" key={message.id}>
              <span className="terminal-prompt-mark">❯</span>
              <span className="terminal-prompt-text">{message.content}</span>
            </div>
          ) : (
            <div className="terminal-output-line" key={message.id}>
              {message.content}
            </div>
          )
        )}
        <span className="terminal-cursor" />
      </div>
    </div>
  );
}
