import { spawn } from "node:child_process";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import { createServer as createNetServer } from "node:net";
import { open, stat } from "node:fs/promises";

import type { CodexMobileModelSettings } from "@abitat_reece/shared";

import {
  createCodexAutomation,
  listCodexAutomations,
  updateCodexAutomation,
  type CodexAutomationStatus
} from "./automations.js";
import { createLocalCodexBridge } from "./codex-bridge.js";
import {
  createMobileControlDiagnosticsLogger,
  mobileControlDiagnosticsLogPath,
  type MobileControlDiagnosticsLogger
} from "./diagnostics-log.js";
import {
  createLocalCodexCompletionNotifier,
  createLocalMobilePushService
} from "./push-notifications.js";
import { startRelayClient } from "./relay-client.js";
import {
  startLocalControlServer,
  type LocalAttachmentReference,
  type LocalCodexBridge,
  type LocalCodexSkillSelection
} from "./server.js";
import { createLocalControlStore, type LocalControlStore } from "./state.js";
import { readCodexTokenUsageSummary, type CodexTokenUsageSummary } from "./token-usage.js";
import { listPluginSuggestions, publicPluginSuggestions } from "./plugin-suggestions.js";

export interface StartDesktopControlServerOptions {
  codex?: LocalCodexBridge;
  codexBinaryPath?: string;
  codexServerUrl?: string;
  connectRelay?: boolean;
  desktopPort?: number;
  diagnostics?: MobileControlDiagnosticsLogger;
  diagnosticsLogPath?: string;
  endpoint?: string;
  localControlPort?: number;
  now?: () => Date;
  openPath?: (path: string) => Promise<void>;
  relayEndpoint?: string;
  revealPath?: (path: string) => Promise<void>;
  store?: LocalControlStore;
  tokenUsageProvider?: () => Promise<CodexTokenUsageSummary>;
}

export interface DesktopControlServer {
  close(): Promise<void>;
  desktopEndpoint: string;
  localEndpoint: string;
  publicEndpoint: string;
  relayEndpoint: string;
  relayId?: string;
}

const DEFAULT_DESKTOP_PORT = 3971;
const DEFAULT_LOCAL_CONTROL_PORT = 3901;
const DEFAULT_RELAY_ENDPOINT = "https://workspace.abitat.io";
const DEFAULT_DIAGNOSTICS_LOG_LIMIT_BYTES = 256 * 1024;

export async function startDesktopControlServer(
  options: StartDesktopControlServerOptions = {}
): Promise<DesktopControlServer> {
  const diagnosticsLogPath = options.diagnosticsLogPath ?? mobileControlDiagnosticsLogPath();
  const diagnostics =
    options.diagnostics ?? createMobileControlDiagnosticsLogger({ logPath: diagnosticsLogPath });
  const store = options.store ?? createLocalControlStore();
  const relayEndpoint =
    options.relayEndpoint ?? process.env.ABITAT_RELAY_ENDPOINT ?? DEFAULT_RELAY_ENDPOINT;
  const localPort = await findAvailablePort(
    options.localControlPort ??
      Number(process.env.ABITAT_LOCAL_CONTROL_PORT ?? DEFAULT_LOCAL_CONTROL_PORT)
  );
  const localEndpoint = `http://127.0.0.1:${localPort}`;
  const publicEndpoint = options.endpoint ?? relayEndpoint;
  const relayId = await store.getRelayId();
  const codex =
    options.codex ??
    createLocalCodexBridge({
      codexBinaryPath: options.codexBinaryPath ?? process.env.CODEX_APP_BINARY ?? "codex",
      diagnostics,
      serverUrl: options.codexServerUrl ?? process.env.CODEX_APP_SERVER_URL ?? "stdio://"
    });
  const localServer = await startLocalControlServer({
    bindHost: "127.0.0.1",
    codex,
    diagnostics,
    endpoint: localEndpoint,
    port: localPort,
    store,
    transport: "relay"
  });
  const relayClient =
    options.connectRelay === false
      ? null
      : startRelayClient({
          diagnostics,
          localEndpoint: localServer.endpoint,
          relayEndpoint,
          relayId,
          store
        });
  const stopCompletionNotifier = createLocalCodexCompletionNotifier({
    codex,
    diagnostics,
    logger: console,
    mobilePushService: createLocalMobilePushService(store, { diagnostics, logger: console })
  }).start();
  const serverStartedAt = (options.now ?? (() => new Date()))().toISOString();

  async function status() {
    const identity = await store.getMacIdentity();
    const codexStatus = await codex.bootstrap().catch((error: unknown) => ({
      available: false,
      error: error instanceof Error ? error.message : String(error)
    }));

    return {
      codex: codexStatus,
      diagnosticsLogPath,
      endpoint: publicEndpoint,
      localEndpoint: localServer.endpoint,
      macId: identity.macId,
      macName: identity.macName,
      relayConnected: options.connectRelay !== false,
      relayEndpoint,
      relayId,
      serverStartedAt,
      transport: "relay"
    };
  }

  const desktopServer = createHttpServer(async (request, response) => {
    const method = request.method ?? "GET";
    let path = "/";

    try {
      if (method === "OPTIONS") {
        writeJson(response, 204, null);
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      path = normalizePath(url.pathname);

      if (method === "GET" && path === "/health") {
        writeJson(response, 200, { ok: true, status: "online" });
        return;
      }

      if (method === "GET" && path === "/api/desktop/status") {
        writeJson(response, 200, await status());
        return;
      }

      if (method === "POST" && path === "/api/desktop/pairing") {
        const pairing = await store.createPairing({
          endpoint: publicEndpoint,
          relayId,
          transport: "relay"
        });
        writeJson(response, 200, {
          expiresAt: pairing.expiresAt,
          manualCode: pairing.manualCode,
          payloadJson: JSON.stringify(pairing),
          relayId: pairing.relayId
        });
        return;
      }

      if (method === "GET" && path === "/api/desktop/projects") {
        writeJson(response, 200, { projects: await codex.listProjects() });
        return;
      }

      if (method === "GET" && path === "/api/desktop/codex/models") {
        writeJson(response, 200, { models: await codex.listModelOptions() });
        return;
      }

      if (method === "GET" && path === "/api/desktop/codex/plugin-suggestions") {
        writeJson(response, 200, {
          suggestions: await safePublicPluginSuggestions()
        });
        return;
      }

      if (method === "GET" && path === "/api/desktop/codex/completions") {
        writeJson(response, 200, { completions: await codex.listCompletionStates() });
        return;
      }

      if (method === "GET" && path === "/api/desktop/codex/token-usage") {
        const tokenUsage = await (options.tokenUsageProvider ?? readCodexTokenUsageSummary)();
        writeJson(response, 200, {
          generatedAt: tokenUsage.generatedAt,
          timeframes: {
            "1d": tokenUsage.oneDay,
            "7d": tokenUsage.sevenDays,
            all: tokenUsage.allTime
          }
        });
        return;
      }

      if (method === "GET" && path === "/api/desktop/codex/automations") {
        writeJson(response, 200, { automations: await listCodexAutomations() });
        return;
      }

      if (method === "POST" && path === "/api/desktop/codex/automations") {
        const automation = await createCodexAutomation(
          {},
          automationWriteInput(await readJson(request))
        );
        writeJson(response, 201, { automation });
        return;
      }

      const automationMatch = matchPath(path, "/api/desktop/codex/automations/:automationId");
      if (automationMatch && method === "PATCH") {
        const automation = await updateCodexAutomation(
          {},
          automationMatch.automationId,
          automationUpdateInput(await readJson(request))
        );
        writeJson(response, 200, { automation });
        return;
      }

      const projectConversationsMatch = matchPath(
        path,
        "/api/desktop/projects/:projectId/conversations"
      );
      if (projectConversationsMatch && method === "GET") {
        writeJson(response, 200, {
          conversations: await codex.listProjectConversations(projectConversationsMatch.projectId)
        });
        return;
      }

      if (projectConversationsMatch && method === "POST") {
        const body = await readJson(request);
        const started = await codex.startConversation(projectConversationsMatch.projectId, {
          attachments: attachmentReferences(body.attachments),
          modelSettings: modelSettings(body),
          prompt: requiredPrompt(body),
          skills: skillSelections(body.skills)
        });
        writeJson(response, 200, started);
        return;
      }

      const messageMatch = matchPath(path, "/api/desktop/conversations/:conversationId/messages");
      if (messageMatch && method === "GET") {
        writeJson(response, 200, {
          messages: await codex.listMessages(messageMatch.conversationId, {
            afterSequence: numberSearchParam(url, "afterSequence"),
            forceRefresh: booleanSearchParam(url, "forceRefresh"),
            includeRuntime: booleanSearchParam(url, "includeRuntime")
          })
        });
        return;
      }

      const continueMatch = matchPath(path, "/api/desktop/conversations/:conversationId/continue");
      if (continueMatch && method === "POST") {
        const body = await readJson(request);
        const continued = await codex.continueConversation(continueMatch.conversationId, {
          attachments: attachmentReferences(body.attachments),
          clientMessageId: stringValue(body.clientMessageId),
          delivery: deliveryMode(body.delivery),
          modelSettings: modelSettings(body),
          prompt: requiredPrompt(body),
          skills: skillSelections(body.skills)
        });
        writeJson(response, 200, continued);
        return;
      }

      const queuedTurnMatch = matchPath(
        path,
        "/api/desktop/conversations/:conversationId/queue/:clientMessageId"
      );
      if (queuedTurnMatch && method === "DELETE") {
        writeJson(
          response,
          200,
          await codex.deleteQueuedTurn(queuedTurnMatch.conversationId, {
            clientMessageId: queuedTurnMatch.clientMessageId
          })
        );
        return;
      }

      if (queuedTurnMatch && method === "PATCH") {
        const body = await readJson(request);
        writeJson(
          response,
          200,
          await codex.updateQueuedTurn(queuedTurnMatch.conversationId, {
            clientMessageId: queuedTurnMatch.clientMessageId,
            prompt: requiredPrompt(body)
          })
        );
        return;
      }

      const filesMatch = matchPath(path, "/api/desktop/conversations/:conversationId/files");
      if (filesMatch && method === "GET") {
        writeJson(response, 200, {
          files: await codex.listGeneratedFiles(filesMatch.conversationId)
        });
        return;
      }

      const downloadMatch = matchPath(
        path,
        "/api/desktop/conversations/:conversationId/files/:fileId/download"
      );
      if (downloadMatch && method === "GET") {
        writeJson(response, 200, {
          file: await codex.downloadGeneratedFile(
            downloadMatch.conversationId,
            downloadMatch.fileId
          )
        });
        return;
      }

      if (method === "GET" && path === "/api/desktop/diagnostics/log") {
        writeJson(
          response,
          200,
          await readDiagnosticsLog(
            diagnosticsLogPath,
            numberSearchParam(url, "limitBytes") ?? DEFAULT_DIAGNOSTICS_LOG_LIMIT_BYTES
          )
        );
        return;
      }

      if (method === "POST" && path === "/api/desktop/reveal-path") {
        const body = await readJson(request);
        await (options.revealPath ?? revealPath)(requiredString(body.path, "Path is required"));
        writeJson(response, 200, { ok: true });
        return;
      }

      if (method === "POST" && path === "/api/desktop/open-path") {
        const body = await readJson(request);
        await (options.openPath ?? openPath)(requiredString(body.path, "Path is required"));
        writeJson(response, 200, { ok: true });
        return;
      }

      writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      writeJson(response, statusCode(error), { error: errorMessage(error), method, path });
    }
  });
  const desktopPort = await findAvailablePort(options.desktopPort ?? DEFAULT_DESKTOP_PORT);
  const desktopEndpoint = await listen(desktopServer, desktopPort);

  return {
    desktopEndpoint,
    localEndpoint: localServer.endpoint,
    publicEndpoint,
    relayEndpoint,
    relayId,
    async close() {
      stopCompletionNotifier();
      relayClient?.close();
      await closeHttpServer(desktopServer);
      await localServer.close();
    }
  };
}

async function readDiagnosticsLog(
  logPath: string,
  limitBytes = DEFAULT_DIAGNOSTICS_LOG_LIMIT_BYTES
) {
  try {
    const stats = await stat(logPath);
    const safeLimitBytes = Math.max(0, Math.min(limitBytes, DEFAULT_DIAGNOSTICS_LOG_LIMIT_BYTES));
    const truncated = stats.size > safeLimitBytes;
    if (safeLimitBytes === 0 || stats.size === 0) {
      return { data: "", logPath, size: stats.size, truncated };
    }

    const offset = truncated ? stats.size - safeLimitBytes : 0;
    const length = truncated ? safeLimitBytes : stats.size;
    const handle = await open(logPath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return {
        data: buffer.subarray(0, bytesRead).toString("utf8"),
        logPath,
        size: stats.size,
        truncated
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      return { data: "", logPath, size: 0, truncated: false };
    }
    throw error;
  }
}

async function findAvailablePort(startPort: number) {
  if (!Number.isInteger(startPort) || startPort <= 0) {
    return 0;
  }

  for (let port = startPort; port <= startPort + 20; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error(`No available port found from ${startPort} to ${startPort + 20}`);
}

function canListen(port: number) {
  return new Promise<boolean>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => (error ? reject(error) : resolve(true)));
    });
  });
}

function listen(server: ReturnType<typeof createHttpServer>, port: number) {
  return new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      const resolvedPort = address && typeof address === "object" ? address.port : port;
      resolve(`http://127.0.0.1:${resolvedPort}`);
    });
  });
}

function closeHttpServer(server: ReturnType<typeof createHttpServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function openPath(path: string) {
  return runDetached("open", [path]);
}

function revealPath(path: string) {
  return runDetached("open", ["-R", path]);
}

function runDetached(command: string, args: string[]) {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
  return Promise.resolve();
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": "http://127.0.0.1",
    "cache-control": "no-store",
    "content-type": "application/json"
  });
  response.end(body === null ? "" : JSON.stringify(body));
}

function normalizePath(path: string) {
  return path.replace(/\/+$/u, "") || "/";
}

function matchPath(path: string, pattern: string) {
  const pathParts = path.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);

  if (pathParts.length !== patternParts.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (const [index, patternPart] of patternParts.entries()) {
    const value = pathParts[index];
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(value);
      continue;
    }
    if (patternPart !== value) {
      return null;
    }
  }
  return params;
}

function requiredPrompt(body: Record<string, unknown>) {
  const prompt = stringValue(body.prompt) || stringValue(body.content);
  if (!prompt.trim()) {
    throw Object.assign(new Error("Prompt is required"), { statusCode: 400 });
  }
  return prompt.trim();
}

function modelSettings(body: Record<string, unknown>): CodexMobileModelSettings | undefined {
  const nested =
    body.modelSettings && typeof body.modelSettings === "object"
      ? (body.modelSettings as Record<string, unknown>)
      : body;
  const model = stringValue(nested.model);
  const effort = stringValue(nested.effort);
  if (!model || !effort) {
    return undefined;
  }
  return { model, effort: effort as CodexMobileModelSettings["effort"] };
}

function attachmentReferences(value: unknown): LocalAttachmentReference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const kind: LocalAttachmentReference["kind"] = candidate.kind === "image" ? "image" : "file";
    const name = stringValue(candidate.name);
    const path = stringValue(candidate.path);
    return name && path ? [{ kind, name, path }] : [];
  });
}

function skillSelections(value: unknown): LocalCodexSkillSelection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const id = stringValue((item as Record<string, unknown>).id);
    return id ? [{ id }] : [];
  });
}

function deliveryMode(value: unknown) {
  return value === "queue" || value === "steer" ? value : undefined;
}

async function safePublicPluginSuggestions() {
  try {
    return publicPluginSuggestions(await listPluginSuggestions());
  } catch {
    return [];
  }
}

function automationWriteInput(body: Record<string, unknown>) {
  return {
    cwds: stringArrayValue(body.cwds),
    executionEnvironment: requiredString(
      body.executionEnvironment,
      "Automation execution environment is required"
    ),
    kind: requiredString(body.kind, "Automation kind is required"),
    model: requiredString(body.model, "Automation model is required"),
    name: requiredString(body.name, "Automation name is required"),
    prompt: requiredString(body.prompt, "Automation prompt is required"),
    reasoningEffort: requiredString(
      body.reasoningEffort,
      "Automation reasoning effort is required"
    ),
    rrule: requiredString(body.rrule, "Automation schedule is required"),
    status: automationStatus(body.status)
  };
}

function automationUpdateInput(body: Record<string, unknown>) {
  const update: Partial<ReturnType<typeof automationWriteInput>> = {};
  for (const key of [
    "executionEnvironment",
    "kind",
    "model",
    "name",
    "prompt",
    "reasoningEffort",
    "rrule"
  ] as const) {
    if (key in body) {
      update[key] = requiredString(body[key], `Automation ${key} is required`);
    }
  }
  if ("cwds" in body) {
    update.cwds = stringArrayValue(body.cwds);
  }
  if ("status" in body) {
    update.status = automationStatus(body.status);
  }
  return update;
}

function automationStatus(value: unknown): CodexAutomationStatus {
  const status = requiredString(value, "Automation status is required").toUpperCase();
  if (status !== "ACTIVE" && status !== "PAUSED") {
    throw Object.assign(new Error("Automation status must be ACTIVE or PAUSED"), {
      statusCode: 400
    });
  }
  return status;
}

function numberSearchParam(url: URL, key: string) {
  const value = url.searchParams.get(key);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanSearchParam(url: URL, key: string) {
  const value = url.searchParams.get(key);
  if (value === null) {
    return undefined;
  }
  return value === "1" || value === "true";
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" ? [item] : []))
    : [];
}

function requiredString(value: unknown, message: string) {
  const string = stringValue(value).trim();
  if (!string) {
    throw Object.assign(new Error(message), { statusCode: 400 });
  }
  return string;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function statusCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }
  return 500;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
