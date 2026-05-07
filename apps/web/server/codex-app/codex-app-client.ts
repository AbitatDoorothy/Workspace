import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import WebSocket from "ws";

import type {
  CodexAppClient,
  CodexAppResponseItem,
  CodexAppStartTurnOptions,
  CodexAppThread,
  CodexAppThreadListParams,
  CodexAppThreadListResponse,
  CodexAppTurn,
  CodexAppUserInput
} from "./codex-app-service";

const DEFAULT_SERVER_URL = "ws://127.0.0.1:47777";
const DEFAULT_CODEX_BINARY = "/Applications/Codex.app/Contents/Resources/codex";
const REQUEST_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 15_000;
const TURN_KEEPALIVE_TIMEOUT_MS = 30 * 60_000;

let spawnedAppServer: ChildProcess | null = null;
let nextRequestId = 1;
const activeTurnKeepAlives = new Set<Promise<void>>();

interface JsonRpcMessage {
  id: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string; code?: number; data?: unknown };
}

interface CodexAppClientOptions {
  serverUrl?: string;
  codexBinaryPath?: string;
}

export function createCodexAppClient(options: CodexAppClientOptions = {}): CodexAppClient {
  const serverUrl = options.serverUrl ?? process.env.CODEX_APP_SERVER_URL ?? DEFAULT_SERVER_URL;
  const codexBinaryPath =
    options.codexBinaryPath ?? process.env.CODEX_APP_BINARY ?? DEFAULT_CODEX_BINARY;

  return {
    async injectItems(threadId: string, items: CodexAppResponseItem[]) {
      await callCodexApp(serverUrl, codexBinaryPath, "thread/inject_items", {
        items,
        threadId
      });
    },

    async listLoadedThreads() {
      const threadIds: string[] = [];
      let cursor: string | null | undefined = null;

      do {
        const response: { data: string[]; nextCursor: string | null } = await callCodexApp(
          serverUrl,
          codexBinaryPath,
          "thread/loaded/list",
          {
            cursor,
            limit: 200
          }
        );
        threadIds.push(...response.data);
        cursor = response.nextCursor;
      } while (cursor);

      return threadIds;
    },

    listThreads(params: CodexAppThreadListParams = {}) {
      return callCodexApp<CodexAppThreadListResponse>(serverUrl, codexBinaryPath, "thread/list", {
        archived: false,
        limit: 200,
        sortDirection: "desc",
        useStateDbOnly: true,
        ...params
      });
    },

    async readThread(threadId: string, includeTurns = true) {
      const response = await callCodexApp<{ thread: CodexAppThread }>(
        serverUrl,
        codexBinaryPath,
        "thread/read",
        {
          includeTurns,
          threadId
        }
      );

      return response.thread;
    },

    resumeThread(params) {
      return callCodexApp<{ thread: CodexAppThread }>(
        serverUrl,
        codexBinaryPath,
        "thread/resume",
        params
      );
    },

    startThread(params) {
      return callCodexApp<{ thread: CodexAppThread }>(serverUrl, codexBinaryPath, "thread/start", {
        experimentalRawEvents: false,
        persistExtendedHistory: true,
        ...params
      });
    },

    startTurn(
      threadId: string,
      input: CodexAppUserInput[],
      options: CodexAppStartTurnOptions = {}
    ) {
      return startTurnWithKeepAlive(serverUrl, codexBinaryPath, threadId, input, options);
    }
  };
}

async function callCodexApp<TResult>(
  serverUrl: string,
  codexBinaryPath: string,
  method: string,
  params: unknown
): Promise<TResult> {
  try {
    return await callCodexAppOnce<TResult>(serverUrl, method, params);
  } catch (error) {
    if (!isConnectionFailure(error) || !canStartLocalServer(serverUrl)) {
      throw error;
    }

    await ensureLocalAppServer(serverUrl, codexBinaryPath);
    return callCodexAppOnce<TResult>(serverUrl, method, params);
  }
}

async function callCodexAppOnce<TResult>(
  serverUrl: string,
  method: string,
  params: unknown
): Promise<TResult> {
  const connection = await JsonRpcConnection.connect(serverUrl);

  try {
    await initializeConnection(connection);

    return await connection.call<TResult>(method, params);
  } finally {
    connection.close();
  }
}

async function startTurnWithKeepAlive(
  serverUrl: string,
  codexBinaryPath: string,
  threadId: string,
  input: CodexAppUserInput[],
  options: CodexAppStartTurnOptions
) {
  try {
    return await startTurnWithKeepAliveOnce(serverUrl, threadId, input, options);
  } catch (error) {
    if (!isConnectionFailure(error) || !canStartLocalServer(serverUrl)) {
      throw error;
    }

    await ensureLocalAppServer(serverUrl, codexBinaryPath);
    return startTurnWithKeepAliveOnce(serverUrl, threadId, input, options);
  }
}

async function startTurnWithKeepAliveOnce(
  serverUrl: string,
  threadId: string,
  input: CodexAppUserInput[],
  options: CodexAppStartTurnOptions
) {
  const connection = await JsonRpcConnection.connect(serverUrl);
  let keepAliveStarted = false;

  try {
    await initializeConnection(connection);
    const response = await connection.call<{ turn: CodexAppTurn }>(
      "turn/start",
      turnStartParams(threadId, input, options)
    );

    if (isTurnInProgress(response.turn)) {
      keepAliveStarted = true;
      keepTurnConnectionAlive(connection, threadId, response.turn.id);
    }

    return response;
  } finally {
    if (!keepAliveStarted) {
      connection.close();
    }
  }
}

async function initializeConnection(connection: JsonRpcConnection) {
  await connection.call("initialize", {
    capabilities: {
      experimentalApi: true
    },
    clientInfo: {
      name: "abitat-workspace",
      version: "0.1.0"
    }
  });
  connection.notify("initialized");
}

function keepTurnConnectionAlive(connection: JsonRpcConnection, threadId: string, turnId: string) {
  let removeNotificationHandler: () => void = () => undefined;
  let removeCloseHandler: () => void = () => undefined;
  let resolveKeepAlive: () => void = () => undefined;
  const timer = setTimeout(() => resolveKeepAlive(), TURN_KEEPALIVE_TIMEOUT_MS);
  timer.unref?.();

  const keepAlive = new Promise<void>((resolve) => {
    resolveKeepAlive = resolve;
    removeNotificationHandler = connection.onNotification((method, params) => {
      if (isTurnFinishedNotification(method, params, threadId, turnId)) {
        resolve();
      }
    });
    removeCloseHandler = connection.onClose(resolve);
  }).finally(async () => {
    clearTimeout(timer);
    removeNotificationHandler();
    removeCloseHandler();
    connection.close();
    activeTurnKeepAlives.delete(keepAlive);
  });

  activeTurnKeepAlives.add(keepAlive);
  void keepAlive;
}

function turnStartParams(
  threadId: string,
  input: CodexAppUserInput[],
  options: CodexAppStartTurnOptions
) {
  return {
    ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    input,
    ...(options.sandboxPolicy ? { sandboxPolicy: options.sandboxPolicy } : {}),
    threadId
  };
}

function isTurnInProgress(turn: CodexAppTurn) {
  return (
    turn.status === "inProgress" ||
    (!!turn.status &&
      typeof turn.status === "object" &&
      (turn.status as { type?: unknown }).type === "inProgress")
  );
}

function isTurnFinishedNotification(
  method: string,
  params: unknown,
  threadId: string,
  turnId: string
) {
  if (!params || typeof params !== "object") {
    return false;
  }

  const notification = params as {
    error?: unknown;
    threadId?: unknown;
    turn?: { id?: unknown };
    turnId?: unknown;
  };

  if (notification.threadId !== threadId) {
    return false;
  }

  if (method === "turn/completed") {
    return notification.turn?.id === turnId || notification.turnId === turnId;
  }

  if (method === "error") {
    return notification.turnId === turnId;
  }

  return (
    method === "thread/status/changed" &&
    (notification as { status?: { type?: unknown } }).status?.type === "idle"
  );
}

class JsonRpcConnection {
  private readonly pending = new Map<
    number,
    { reject(error: Error): void; resolve(value: unknown): void; timer: NodeJS.Timeout }
  >();
  private readonly notificationHandlers = new Set<(method: string, params: unknown) => void>();
  private readonly closeHandlers = new Set<() => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString()));
    socket.on("close", () => {
      this.rejectAll(new Error("Codex app-server connection closed"));
      for (const handler of this.closeHandlers) {
        handler();
      }
      this.closeHandlers.clear();
    });
    socket.on("error", (error) =>
      this.rejectAll(error instanceof Error ? error : new Error(String(error)))
    );
  }

  static connect(serverUrl: string) {
    return new Promise<JsonRpcConnection>((resolve, reject) => {
      const socket = new WebSocket(serverUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to Codex app-server at ${serverUrl}`));
      }, REQUEST_TIMEOUT_MS);

      socket.once("open", () => {
        clearTimeout(timer);
        resolve(new JsonRpcConnection(socket));
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  onNotification(handler: (method: string, params: unknown) => void) {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  onClose(handler: () => void) {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  call<TResult = unknown>(
    method: string,
    params: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<TResult> {
    const id = nextRequestId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server response to ${method}`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, {
        reject,
        resolve: (value) => resolve(value as TResult),
        timer
      });
      this.socket.send(payload, (error) => {
        if (!error) {
          return;
        }

        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method: string, params?: unknown) {
    this.socket.send(JSON.stringify(params === undefined ? { method } : { method, params }));
  }

  close() {
    this.socket.close();
  }

  private handleMessage(raw: string) {
    let message: JsonRpcMessage;

    try {
      message = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return;
    }

    if (message.method && !("result" in message) && !("error" in message)) {
      for (const handler of this.notificationHandlers) {
        handler(message.method, message.params);
      }
      return;
    }

    if (!("id" in message) || !("result" in message || "error" in message)) {
      return;
    }

    const id = typeof message.id === "number" ? message.id : Number(message.id);
    const pending = this.pending.get(id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (message.error) {
      pending.reject(new Error(message.error.message ?? "Codex app-server request failed"));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

async function ensureLocalAppServer(serverUrl: string, codexBinaryPath: string) {
  if (!spawnedAppServer || spawnedAppServer.exitCode !== null || spawnedAppServer.killed) {
    spawnedAppServer = spawn(
      codexBinaryPath,
      ["app-server", "--listen", serverUrl, "--analytics-default-enabled"],
      {
        detached: true,
        stdio: "ignore"
      }
    );
    spawnedAppServer.unref();
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (await canOpenWebSocket(serverUrl)) {
      return;
    }

    await delay(250);
  }

  throw new Error("Unable to start Codex app-server. Open Codex.app or set CODEX_APP_SERVER_URL.");
}

function canOpenWebSocket(serverUrl: string) {
  return new Promise<boolean>((resolve) => {
    const socket = new WebSocket(serverUrl);
    const timer = setTimeout(() => {
      socket.close();
      resolve(false);
    }, 1000);

    socket.once("open", () => {
      clearTimeout(timer);
      socket.close();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function canStartLocalServer(serverUrl: string) {
  try {
    const url = new URL(serverUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function isConnectionFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|closed before|connection closed|Timed out connecting|Unexpected server response/.test(
    error.message
  );
}
