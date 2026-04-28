"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

interface TerminalViewProps {
  conversationId: string;
  initialPrompt?: string;
}

interface RunEventMessage {
  sequence: number;
  type: string;
  content: string;
}

export function TerminalView({ conversationId, initialPrompt }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const finishedRef = useRef(false);
  const promptShownRef = useRef(false);
  const seenSequencesRef = useRef<Set<number>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const { Terminal } = await import("@xterm/xterm");

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
        theme: {
          background: "#0b0e14",
          foreground: "#c2c6d6",
          cursor: "#a1a1aa"
        },
        cols: 100,
        rows: 30
      });

      term.open(containerRef.current);
      termRef.current = term;

      const showPrompt = (prompt: string) => {
        if (!prompt.trim()) return;
        if (promptShownRef.current) return;
        promptShownRef.current = true;
        term.writeln("");
        term.writeln("--- Task ---");
        for (const line of prompt.split("\n")) {
          term.writeln(line);
        }
        term.writeln("--- Starting runtime ---");
        term.writeln("");
      };

      const startEventStreamFallback = (reason: string) => {
        if (eventSourceRef.current) return;
        showPrompt(initialPrompt ?? "");
        term.writeln(reason);
        const source = new EventSource(`/api/conversations/${conversationId}/events/stream`);
        eventSourceRef.current = source;

        source.addEventListener("run-event", (message) => {
          const event = JSON.parse((message as MessageEvent).data) as RunEventMessage;
          if (seenSequencesRef.current.has(event.sequence)) return;
          seenSequencesRef.current.add(event.sequence);

          if (event.type === "stdout" || event.type === "stderr") {
            term.writeln(event.content);
          }

          if (event.type === "status") {
            term.writeln(`> ${event.content}`);
          }
        });
      };

      showPrompt(initialPrompt ?? "");

      // Connect to the terminal WebSocket relay.
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${protocol}://${window.location.host}/api/conversations/${conversationId}/terminal`
      );
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        term.writeln("connecting to runtime...");
      });

      ws.addEventListener("message", (event) => {
        let msg: { type: string; data?: string; prompt?: string; exitCode?: number };
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }

        if (msg.type === "init" && msg.prompt) {
          showPrompt(msg.prompt);
        }

        if (msg.type === "output" && msg.data) {
          term.write(msg.data);
        }

        if (msg.type === "exit") {
          finishedRef.current = true;
          term.writeln("");
          term.writeln(`--- Runtime exited (code ${msg.exitCode ?? "?"}) ---`);
        }
      });

      ws.addEventListener("close", () => {
        if (termRef.current === term && !finishedRef.current) {
          startEventStreamFallback("--- Terminal socket unavailable; following event stream ---");
        }
      });

      ws.addEventListener("error", () => {
        if (termRef.current === term) {
          startEventStreamFallback("--- Terminal socket error; following event stream ---");
        }
      });

      // Send keystrokes to the daemon via WebSocket.
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });
    })();

    return () => {
      disposed = true;
      wsRef.current?.close();
      eventSourceRef.current?.close();
      termRef.current?.dispose();
    };
  }, [conversationId]);

  return <div ref={containerRef} className="terminal-container" />;
}
