import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { createPtyRuntimeAdapter } from "../src/runtime/pty";

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

class FakePty {
  dataHandlers: Array<(data: string) => void> = [];
  exitHandlers: Array<(event: { exitCode: number }) => void> = [];
  writes: string[] = [];
  killed = false;

  write(data: string) {
    this.writes.push(data);
  }

  kill() {
    this.killed = true;
  }

  resize() {}

  onData(handler: (data: string) => void) {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (event: { exitCode: number }) => void) {
    this.exitHandlers.push(handler);
  }

  output(data: string) {
    for (const handler of this.dataHandlers) {
      handler(data);
    }
  }

  exit(exitCode: number) {
    for (const handler of this.exitHandlers) {
      handler({ exitCode });
    }
  }
}

describe("PTY runtime adapter", () => {
  it("writes the initial prompt to the local PTY instead of waiting for a browser terminal", async () => {
    const socket = new FakeSocket();
    const pty = new FakePty();
    const events: { type: string; content: string }[] = [];
    let capturedArgs: string[] = [];
    const adapter = createPtyRuntimeAdapter("codex", "https://workspace.example", undefined, {
      checkCommand: async () => ({ installed: true, path: "/usr/local/bin/codex" }),
      createSocket: async () => socket,
      spawnPty: (_command, args) => {
        capturedArgs = args;
        return pty;
      }
    });

    const run = adapter.run(
      {
        conversationId: "conversation_demo",
        worktreePath: "/Users/reece/Desktop/Test",
        prompt: "Create a file named pass.txt.",
        model: "5.4",
        instructions: "Keep changes small.",
        allowedTools: ["git"],
        skipGitRepoCheck: true
      },
      async (event) => {
        events.push(event);
      }
    );

    await waitFor(() => pty.writes.length > 0);
    pty.output("working\n");
    pty.exit(0);

    await expect(run).resolves.toBeUndefined();
    expect(capturedArgs).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--disable",
      "plugins",
      "--disable",
      "general_analytics",
      "--model",
      "gpt-5.4",
      "--full-auto",
      "-"
    ]);
    expect(pty.writes.join("")).toContain("Create a file named pass.txt.");
    expect(socket.sent.some((message) => message.includes('"type":"init"'))).toBe(true);
    expect(events).toContainEqual({ type: "stdout", content: "working" });
  });

  it("rejects non-zero PTY exits without throwing from the exit callback", async () => {
    const pty = new FakePty();
    const adapter = createPtyRuntimeAdapter("codex", "https://workspace.example", undefined, {
      checkCommand: async () => ({ installed: true, path: "/usr/local/bin/codex" }),
      createSocket: async () => new FakeSocket(),
      spawnPty: () => pty
    });

    const run = adapter.run(
      {
        conversationId: "conversation_demo",
        worktreePath: "/Users/reece/Desktop/Test",
        prompt: "Fail clearly.",
        model: "5.4",
        instructions: "Keep changes small."
      },
      async () => {}
    );

    await waitFor(() => pty.writes.length > 0);
    pty.exit(2);

    await expect(run).rejects.toThrow("codex exited with code 2");
  });
});

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for condition");
}
