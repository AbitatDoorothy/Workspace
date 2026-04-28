import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket as WsClient } from "ws";

import { hostService } from "../hosts";

interface TerminalPair {
  daemon: WsClient | null;
  browsers: Set<WsClient>;
}

const pairs = new Map<string, TerminalPair>();

function getOrCreatePair(conversationId: string): TerminalPair {
  let pair = pairs.get(conversationId);
  if (!pair) {
    pair = { daemon: null, browsers: new Set() };
    pairs.set(conversationId, pair);
  }
  return pair;
}

export function createTerminalWss() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WsClient, _request: IncomingMessage, isDaemon: boolean) => {
    const conversationId = parseConversationId(_request.url ?? "");
    if (!conversationId) {
      ws.close(4000, "Missing conversation ID");
      return;
    }

    const pair = getOrCreatePair(conversationId);

    if (isDaemon) {
      if (pair.daemon) pair.daemon.close();
      pair.daemon = ws;

      ws.on("message", (raw) => {
        for (const browser of pair.browsers) {
          if (browser.readyState === browser.OPEN) {
            browser.send(raw.toString());
          }
        }
      });

      ws.on("close", () => {
        pair.daemon = null;
        for (const browser of pair.browsers) browser.close();
        pair.browsers.clear();
      });

      ws.on("error", () => {
        pair.daemon = null;
      });
    } else {
      pair.browsers.add(ws);

      ws.on("message", (raw) => {
        if (pair.daemon && pair.daemon.readyState === pair.daemon.OPEN) {
          pair.daemon.send(raw.toString());
        }
      });

      ws.on("close", () => {
        pair.browsers.delete(ws);
        if (pair.browsers.size === 0 && !pair.daemon) {
          pairs.delete(conversationId);
        }
      });

      ws.on("error", () => {
        pair.browsers.delete(ws);
      });
    }
  });

  return wss;
}

export async function handleTerminalUpgrade(
  request: IncomingMessage,
  socket: Parameters<WebSocketServer["handleUpgrade"]>[1],
  head: Parameters<WebSocketServer["handleUpgrade"]>[2],
  wss: WebSocketServer
) {
  const conversationId = parseConversationId(request.url ?? "");
  if (!conversationId) {
    socket.destroy();
    return;
  }

  const isDaemon = await verifyHostToken(request);

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request, isDaemon);
  });
}

function parseConversationId(url: string): string | null {
  const match = url.match(/\/api\/conversations\/([^/?]+)\/terminal/);
  return match?.[1] ?? null;
}

async function verifyHostToken(request: IncomingMessage): Promise<boolean> {
  const header = request.headers["authorization"] ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) return false;
  try {
    return await hostService.verifyAnyHostToken(token);
  } catch {
    return false;
  }
}
