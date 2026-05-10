import { AddressInfo } from "node:net";

import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalCodexBridge } from "../src/local-control/codex-bridge";

const openServers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("local Codex bridge loading performance", () => {
  it("lists project conversations without reading full thread history", async () => {
    const calls: string[] = [];
    const { serverUrl } = await startMockCodexAppServer((socket, message) => {
      if (message.method) {
        calls.push(message.method);
      }

      if (message.method === "initialize") {
        sendResult(socket, message.id, {});
      }

      if (message.method === "thread/list") {
        sendResult(socket, message.id, {
          data: [
            {
              createdAt: 1_778_000_000,
              cwd: "/Users/reece/Desktop/Fast Project",
              ephemeral: false,
              id: "thread_fast",
              name: null,
              preview: "Make loading faster",
              status: { type: "active", activeFlags: [] },
              turns: [],
              updatedAt: 1_778_000_050
            }
          ],
          nextCursor: null
        });
      }

      if (message.method === "thread/read") {
        sendResult(socket, message.id, {
          thread: {
            createdAt: 1_778_000_000,
            cwd: "/Users/reece/Desktop/Fast Project",
            ephemeral: false,
            id: "thread_fast",
            name: null,
            preview: "Make loading faster",
            status: { type: "active", activeFlags: [] },
            turns: [],
            updatedAt: 1_778_000_050
          }
        });
      }
    });
    const bridge = createLocalCodexBridge({ codexBinaryPath: "/unused", serverUrl });

    const [project] = await bridge.listProjects();
    const conversations = await bridge.listProjectConversations(project.id);

    expect(conversations).toEqual([
      expect.objectContaining({
        id: "codex_thread_thread_fast",
        prompt: "Make loading faster",
        worktreePath: "/Users/reece/Desktop/Fast Project"
      })
    ]);
    expect(calls.filter((method) => method === "thread/read")).toHaveLength(0);
  });
});

async function startMockCodexAppServer(
  onMessage: (socket: WebSocket, message: Record<string, any>) => void
) {
  const server = new WebSocketServer({ port: 0 });
  openServers.push(server);
  server.on("connection", (socket) => {
    socket.on("message", (raw) => onMessage(socket, JSON.parse(String(raw))));
  });

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return { serverUrl: `ws://127.0.0.1:${address.port}` };
}

function sendResult(socket: WebSocket, id: unknown, result: unknown) {
  socket.send(JSON.stringify({ id, result }));
}
