import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

import type {
  CodexMobileModelSettings,
  CodexModelOption,
  ConversationStatus
} from "@abitat_reece/shared";

import {
  defaultLocalAttachmentDirectory,
  type LocalControlStore,
  type LocalControlTransport,
  type LocalPairedDevice
} from "./state.js";
import {
  attachmentDiagnostics,
  errorDiagnostics,
  logDiagnostics,
  promptDiagnostics,
  type MobileControlDiagnosticsLogger
} from "./diagnostics-log.js";

export interface LocalCodexProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  hostLocalPath: string;
  createdByUserId: string;
  repoSyncStatus: "codex_app";
  conversationCount: number;
  source: "codex_app";
  updatedAt: string;
}

export interface LocalCodexConversationSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  agentId?: string;
  createdByUserId?: string;
  type: string;
  status: ConversationStatus | string;
  prompt: string;
  branchName?: string | null;
  runtimeSessionId?: string | null;
  worktreePath?: string | null;
  source: "codex_app";
  codexDeepLink?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface LocalCodexMessage {
  id: string;
  conversationId: string;
  sequence: number;
  role: "user" | "assistant" | "system" | "runtime";
  sourceDeviceId?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type LocalCodexDeliveryMode = "queue" | "steer";

export interface LocalGeneratedFileSummary {
  id: string;
  mimeType: string;
  name: string;
  path: string;
  size: number;
}

export interface LocalGeneratedFileDownload extends LocalGeneratedFileSummary {
  dataBase64: string;
}

export interface LocalCodexCompletionState {
  conversationId: string;
  failed: boolean;
  isComplete: boolean;
  latestTurnCompletedAt: string | null;
  latestTurnId: string | null;
  projectId: string;
  projectName?: string;
  prompt: string;
  source: "codex_app";
  status: ConversationStatus | string;
  updatedAt: string;
  workspaceId: string;
}

export interface LocalCodexBridge {
  bootstrap(): Promise<{ available: boolean; error?: string }>;
  continueConversation(
    conversationId: string,
    input: {
      attachments?: LocalAttachmentReference[];
      delivery?: LocalCodexDeliveryMode;
      modelSettings?: CodexMobileModelSettings;
      prompt: string;
    }
  ): Promise<{ conversationId: string; status: ConversationStatus | string }>;
  listCompletionStates(): Promise<LocalCodexCompletionState[]>;
  downloadGeneratedFile(
    conversationId: string,
    fileId: string
  ): Promise<LocalGeneratedFileDownload>;
  listMessages(
    conversationId: string,
    options?: { afterSequence?: number; includeRuntime?: boolean }
  ): Promise<LocalCodexMessage[]>;
  listGeneratedFiles(conversationId: string): Promise<LocalGeneratedFileSummary[]>;
  listModelOptions(): Promise<CodexModelOption[]>;
  listProjectConversations(projectId: string): Promise<LocalCodexConversationSummary[]>;
  listProjects(): Promise<LocalCodexProjectSummary[]>;
  startConversation(
    projectId: string,
    input: {
      attachments?: LocalAttachmentReference[];
      modelSettings?: CodexMobileModelSettings;
      prompt: string;
    }
  ): Promise<{ conversationId: string; status: ConversationStatus | string }>;
}

export interface LocalAttachmentReference {
  kind: "file" | "image";
  name: string;
  path: string;
}

interface StartLocalControlServerInput {
  attachmentDirectory?: string;
  bindHost: string;
  codex: LocalCodexBridge;
  diagnostics?: MobileControlDiagnosticsLogger;
  endpoint: string;
  port: number;
  store: LocalControlStore;
  transport: LocalControlTransport;
}

interface RemoteSession {
  id: string;
  status: "requested" | "connecting" | "active" | "ended" | "failed";
  hostMachineId: string;
  clientMachineId: string;
  screenEnabled: boolean;
  inputEnabled: boolean;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RemoteSignal {
  id: string;
  sessionId: string;
  senderMachineId: string;
  recipientMachineId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const LOCAL_WORKSPACE_ID = "local";

export async function startLocalControlServer(input: StartLocalControlServerInput) {
  const identity = await input.store.getMacIdentity();
  const diagnostics = input.diagnostics;
  const sessions = new Map<string, RemoteSession>();
  const signals: RemoteSignal[] = [];
  let endpoint = input.endpoint;

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    let path = "/";
    try {
      if (method === "OPTIONS") {
        writeJson(response, 204, null);
        return;
      }

      const url = new URL(request.url ?? "/", endpoint);
      path = normalizePath(url.pathname);

      if (method === "GET" && path === "/health") {
        const codex = await input.codex.bootstrap().catch((error: unknown) => ({
          available: false,
          error: errorMessage(error)
        }));
        writeJson(response, 200, {
          ok: true,
          macId: identity.macId,
          macName: identity.macName,
          status: "online",
          serverTime: new Date().toISOString(),
          transport: input.transport,
          codex
        });
        return;
      }

      if (
        method === "POST" &&
        (path === "/pairing/consume" || path === "/api/mobile/pairing/complete")
      ) {
        const body = await readJson(request);
        let pairing: Awaited<ReturnType<LocalControlStore["consumePairing"]>>;
        try {
          pairing = await input.store.consumePairing({
            code: stringValue(body.code),
            deviceName: stringValue(body.deviceName) || "iPhone",
            manualCode: stringValue(body.manualCode),
            pairingSecret: stringValue(body.pairingSecret),
            platform: stringValue(body.platform) || "ios"
          });
        } catch (error) {
          const message = errorMessage(error);
          logDiagnostics(
            diagnostics,
            "warn",
            message.includes("expired") ? "pairing.expired" : "pairing.rejected",
            {
              error: message,
              hasManualCode: Boolean(stringValue(body.manualCode) || stringValue(body.code)),
              hasPairingSecret: Boolean(stringValue(body.pairingSecret)),
              method,
              path,
              platform: stringValue(body.platform) || "ios"
            }
          );
          throw error;
        }
        logDiagnostics(diagnostics, "info", "pairing.consumed", {
          deviceId: pairing.machineId,
          hostMachineId: pairing.hostMachineId,
          method,
          path,
          platform: stringValue(body.platform) || "ios",
          workspaceId: pairing.workspaceId
        });
        writeJson(response, 201, pairing);
        return;
      }

      const actor = await requireMobileDevice(request, input.store).catch((error: unknown) => {
        logDiagnostics(diagnostics, "warn", "mobile_request.rejected", {
          error: errorDiagnostics(error),
          hasAuthorization: hasAuthorizationHeader(request),
          method,
          path,
          status: statusCode(error)
        });
        throw error;
      });
      logDiagnostics(diagnostics, "info", "mobile_request.authenticated", {
        deviceId: actor.id,
        method,
        path,
        platform: actor.platform
      });

      if (method === "GET" && (path === "/me" || path === "/api/mobile/bootstrap")) {
        writeJson(response, 200, {
          workspace: { id: LOCAL_WORKSPACE_ID, name: `${identity.macName} Local` },
          phone: {
            id: actor.id,
            name: actor.name,
            status: "online"
          },
          host: {
            id: identity.macId,
            name: identity.macName,
            status: "online"
          }
        });
        return;
      }

      if (method === "GET" && path === "/api/mobile/projects") {
        const projects = await input.codex.listProjects();
        logDiagnostics(diagnostics, "info", "projects.list.result", {
          count: projects.length,
          deviceId: actor.id
        });
        writeJson(response, 200, { projects });
        return;
      }

      if (method === "GET" && path === "/api/mobile/codex/models") {
        writeJson(response, 200, { models: await input.codex.listModelOptions() });
        return;
      }

      if (method === "GET" && path === "/api/mobile/codex/completions") {
        const completions = await input.codex.listCompletionStates();
        logDiagnostics(diagnostics, "info", "completion.states.list.result", {
          count: completions.length,
          deviceId: actor.id
        });
        writeJson(response, 200, { completions });
        return;
      }

      if (method === "POST" && path === "/api/mobile/notifications/register") {
        const body = await readJson(request);
        const subscription = await input.store.registerPushSubscription(actor.id, {
          platform: stringValue(body.platform) || "ios",
          provider: stringValue(body.provider) || "expo",
          token: requiredString(body.token, "Push token is required")
        });
        writeJson(response, 200, {
          ok: true,
          subscription: {
            platform: subscription.platform,
            provider: subscription.provider
          }
        });
        logDiagnostics(diagnostics, "info", "push.register.result", {
          deviceId: actor.id,
          platform: subscription.platform,
          provider: subscription.provider
        });
        return;
      }

      if (method === "POST" && path === "/api/mobile/notifications/diagnostics") {
        const body = await readJson(request);
        logDiagnostics(diagnostics, "warn", "push.registration.diagnostic", {
          deviceId: actor.id,
          message: stringValue(body.message),
          stage: stringValue(body.stage)
        });
        writeJson(response, 200, { ok: true });
        return;
      }

      const projectConversationsMatch = matchPath(
        path,
        "/api/mobile/projects/:projectId/conversations"
      );
      if (projectConversationsMatch && method === "GET") {
        const conversations = await input.codex.listProjectConversations(
          projectConversationsMatch.projectId
        );
        logDiagnostics(diagnostics, "info", "conversations.list.result", {
          count: conversations.length,
          deviceId: actor.id,
          projectId: projectConversationsMatch.projectId
        });
        writeJson(response, 200, { conversations });
        return;
      }

      if (projectConversationsMatch && method === "POST") {
        const body = await readJson(request);
        const attachments = attachmentReferences(body.attachments);
        const prompt = requiredPrompt(body);
        logDiagnostics(diagnostics, "info", "conversation.start.request", {
          ...promptDiagnostics(prompt),
          ...attachmentDiagnostics(attachments),
          deviceId: actor.id,
          model: stringValue(body.model) || undefined,
          projectId: projectConversationsMatch.projectId
        });
        let started: Awaited<ReturnType<LocalCodexBridge["startConversation"]>>;
        try {
          started = await input.codex.startConversation(projectConversationsMatch.projectId, {
            attachments,
            modelSettings: modelSettings(body),
            prompt
          });
        } catch (error) {
          const status = statusCode(error);
          logDiagnostics(diagnostics, "error", "conversation.start.failure", {
            error: errorDiagnostics(error),
            projectId: projectConversationsMatch.projectId,
            status
          });
          throw error;
        }
        logDiagnostics(diagnostics, "info", "conversation.start.result", {
          conversationId: started.conversationId,
          projectId: projectConversationsMatch.projectId,
          status: started.status
        });
        writeJson(response, 201, started);
        return;
      }

      const messageMatch = matchPath(path, "/api/mobile/conversations/:conversationId/messages");
      if (messageMatch && method === "GET") {
        const afterSequence = numberQuery(url.searchParams.get("afterSequence"));
        const includeRuntime = url.searchParams.get("includeRuntime") === "true";
        const messages = await input.codex.listMessages(messageMatch.conversationId, {
          afterSequence,
          includeRuntime
        });
        logDiagnostics(diagnostics, "info", "messages.list.result", {
          ...messageCounts(messages),
          afterSequence,
          conversationId: messageMatch.conversationId,
          includeRuntime,
          returned: messages.length
        });
        writeJson(response, 200, {
          messages
        });
        return;
      }

      const generatedFilesMatch = matchPath(
        path,
        "/api/mobile/conversations/:conversationId/files"
      );
      if (generatedFilesMatch && method === "GET") {
        writeJson(response, 200, {
          files: await input.codex.listGeneratedFiles(generatedFilesMatch.conversationId)
        });
        return;
      }

      const generatedFileDownloadMatch = matchPath(
        path,
        "/api/mobile/conversations/:conversationId/files/:fileId/download"
      );
      if (generatedFileDownloadMatch && method === "GET") {
        writeJson(response, 200, {
          file: await input.codex.downloadGeneratedFile(
            generatedFileDownloadMatch.conversationId,
            generatedFileDownloadMatch.fileId
          )
        });
        return;
      }

      if (messageMatch && method === "POST") {
        const body = await readJson(request);
        const prompt = stringValue(body.content) || requiredPrompt(body);
        const delivery = deliveryMode(body.delivery);
        logDiagnostics(diagnostics, "info", "conversation.continue.request", {
          ...promptDiagnostics(prompt),
          conversationId: messageMatch.conversationId,
          delivery,
          deviceId: actor.id
        });
        let continued: Awaited<ReturnType<LocalCodexBridge["continueConversation"]>>;
        try {
          continued = await input.codex.continueConversation(messageMatch.conversationId, {
            delivery,
            prompt
          });
        } catch (error) {
          const status = statusCode(error);
          logDiagnostics(diagnostics, "error", "conversation.continue.failure", {
            conversationId: messageMatch.conversationId,
            error: errorDiagnostics(error),
            status
          });
          throw error;
        }
        logDiagnostics(diagnostics, "info", "conversation.continue.result", {
          conversationId: continued.conversationId,
          status: continued.status
        });
        const messages = await input.codex.listMessages(continued.conversationId);
        writeJson(response, 201, { message: messages.at(-1) ?? null });
        return;
      }

      const continueMatch = matchPath(path, "/api/mobile/conversations/:conversationId/continue");
      if (continueMatch && method === "POST") {
        const body = await readJson(request);
        const attachments = attachmentReferences(body.attachments);
        const delivery = deliveryMode(body.delivery);
        const prompt = requiredPrompt(body);
        logDiagnostics(diagnostics, "info", "conversation.continue.request", {
          ...promptDiagnostics(prompt),
          ...attachmentDiagnostics(attachments),
          conversationId: continueMatch.conversationId,
          delivery,
          deviceId: actor.id,
          model: stringValue(body.model) || undefined
        });
        let continued: Awaited<ReturnType<LocalCodexBridge["continueConversation"]>>;
        try {
          continued = await input.codex.continueConversation(continueMatch.conversationId, {
            attachments,
            delivery,
            modelSettings: modelSettings(body),
            prompt
          });
        } catch (error) {
          const status = statusCode(error);
          logDiagnostics(diagnostics, "error", "conversation.continue.failure", {
            conversationId: continueMatch.conversationId,
            error: errorDiagnostics(error),
            status
          });
          throw error;
        }
        logDiagnostics(diagnostics, "info", "conversation.continue.result", {
          conversationId: continued.conversationId,
          status: continued.status
        });
        writeJson(response, 200, continued);
        return;
      }

      if (method === "POST" && path === "/api/mobile/attachments") {
        const attachment = await saveAttachment(
          input.attachmentDirectory ?? defaultLocalAttachmentDirectory(),
          await readJson(request)
        );
        logDiagnostics(diagnostics, "info", "attachment.saved", {
          deviceId: actor.id,
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          size: attachment.size
        });
        writeJson(response, 201, { attachment });
        return;
      }

      if (method === "GET" && path === "/remote-control/status") {
        writeJson(response, 200, {
          sessions: Array.from(sessions.values()).filter(
            (session) => session.clientMachineId === actor.id
          )
        });
        return;
      }

      if (
        method === "GET" &&
        (path === "/api/remote-control/sessions" || path === "/remote-control/sessions")
      ) {
        writeJson(response, 200, {
          sessions: Array.from(sessions.values()).filter(
            (session) => session.clientMachineId === actor.id
          )
        });
        return;
      }

      if (
        method === "POST" &&
        (path === "/api/remote-control/sessions" || path === "/remote-control/start")
      ) {
        const body = await readJson(request);
        const hostMachineId = stringValue(body.hostMachineId) || identity.macId;
        if (hostMachineId !== identity.macId) {
          throw Object.assign(new Error("Phone is not paired to this Mac host"), {
            statusCode: 403
          });
        }
        const timestamp = new Date().toISOString();
        const session: RemoteSession = {
          id: `remote_${randomBytes(8).toString("hex")}`,
          status: "requested",
          hostMachineId,
          clientMachineId: actor.id,
          screenEnabled: body.screenEnabled !== false,
          inputEnabled: body.inputEnabled !== false,
          errorMessage: null,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        sessions.set(session.id, session);
        writeJson(response, 201, { session });
        return;
      }

      const remoteSessionMatch = matchPath(path, "/api/remote-control/sessions/:sessionId");
      if (remoteSessionMatch && method === "DELETE") {
        const session = requireRemoteSession(sessions, remoteSessionMatch.sessionId, actor.id);
        const ended = { ...session, status: "ended" as const, updatedAt: new Date().toISOString() };
        sessions.set(session.id, ended);
        writeJson(response, 200, { session: ended });
        return;
      }

      const signalMatch = matchPath(path, "/api/remote-control/sessions/:sessionId/signals");
      if (signalMatch && method === "GET") {
        requireRemoteSession(sessions, signalMatch.sessionId, actor.id);
        writeJson(response, 200, {
          signals: signals.filter(
            (signal) =>
              signal.sessionId === signalMatch.sessionId &&
              (!signal.recipientMachineId || signal.recipientMachineId === actor.id)
          )
        });
        return;
      }

      if (
        (signalMatch && method === "POST") ||
        (path === "/remote-control/input" && method === "POST")
      ) {
        const body = await readJson(request);
        const sessionId = signalMatch?.sessionId ?? stringValue(body.sessionId);
        const session = requireRemoteSession(sessions, sessionId, actor.id);
        const signal: RemoteSignal = {
          id: `signal_${randomBytes(8).toString("hex")}`,
          sessionId: session.id,
          senderMachineId: actor.id,
          recipientMachineId: stringValue(body.recipientMachineId) || identity.macId,
          type: stringValue(body.type) || "input",
          payload: recordValue(body.payload) ?? { event: body.event },
          createdAt: new Date().toISOString()
        };
        signals.push(signal);
        writeJson(response, 201, { signal });
        return;
      }

      writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      const status = statusCode(error);
      if (status >= 500) {
        logDiagnostics(diagnostics, "error", "mobile_request.failure", {
          error: errorDiagnostics(error),
          method,
          path,
          status
        });
      }
      writeJson(response, status, { error: errorMessage(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.bindHost, () => {
      server.off("error", reject);
      const address = server.address();
      if (address && typeof address === "object" && input.endpoint.endsWith(":0")) {
        endpoint = input.endpoint.replace(/:0$/u, `:${address.port}`);
      }
      logDiagnostics(diagnostics, "info", "local_control.server_start", {
        bindHost: input.bindHost,
        endpoint,
        port: address && typeof address === "object" ? address.port : input.port,
        transport: input.transport
      });
      resolve();
    });
  });

  return {
    get endpoint() {
      return endpoint;
    },
    server,
    close: () => closeServer(server)
  };
}

async function requireMobileDevice(request: IncomingMessage, store: LocalControlStore) {
  const header = request.headers.authorization;
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    throw Object.assign(new Error("Invalid mobile token"), { statusCode: 401 });
  }

  try {
    return await store.requireDeviceByToken(token);
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      statusCode: 401
    });
  }
}

function hasAuthorizationHeader(request: IncomingMessage) {
  return typeof request.headers.authorization === "string" && request.headers.authorization !== "";
}

function requireRemoteSession(
  sessions: Map<string, RemoteSession>,
  sessionId: string,
  clientMachineId: string
) {
  const session = sessions.get(sessionId);

  if (!session || session.clientMachineId !== clientMachineId) {
    throw Object.assign(new Error("Remote-control session not found"), { statusCode: 404 });
  }

  return session;
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
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": "*",
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
  const model = stringValue(body.model);
  const effort = stringValue(body.effort);
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
    const kind = candidate.kind === "image" ? "image" : "file";
    const name = stringValue(candidate.name);
    const path = stringValue(candidate.path);
    return name && path ? [{ kind, name, path }] : [];
  });
}

async function saveAttachment(directory: string, body: Record<string, unknown>) {
  const dataBase64 = stringValue(body.dataBase64);
  const fileName = safeFileName(stringValue(body.fileName) || "attachment.bin");
  const mimeType = stringValue(body.mimeType) || "application/octet-stream";
  if (!dataBase64) {
    throw Object.assign(new Error("Attachment data is required"), { statusCode: 400 });
  }

  const id = `attachment_${randomBytes(8).toString("hex")}`;
  const path = join(directory, id, fileName);
  const bytes = Buffer.from(dataBase64, "base64");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);

  return {
    kind: mimeType.startsWith("image/") ? "image" : "file",
    mimeType,
    name: fileName,
    path,
    size: bytes.byteLength
  };
}

function deliveryMode(input: unknown): LocalCodexDeliveryMode | undefined {
  return input === "queue" || input === "steer" ? input : undefined;
}

function safeFileName(value: string) {
  return value.replace(/[/\\]/gu, "_").slice(0, 240) || "attachment.bin";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredString(value: unknown, message: string) {
  const parsed = stringValue(value);
  if (!parsed) {
    throw Object.assign(new Error(message), { statusCode: 400 });
  }
  return parsed;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberQuery(value: string | null) {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function messageCounts(messages: LocalCodexMessage[]) {
  const counts = {
    assistant: 0,
    runtime: 0,
    user: 0,
    visible: 0
  };

  for (const message of messages) {
    if (message.role === "assistant") {
      counts.assistant += 1;
      counts.visible += 1;
    } else if (message.role === "user") {
      counts.user += 1;
      counts.visible += 1;
    } else if (message.role === "runtime") {
      counts.runtime += 1;
    }
  }

  return counts;
}

function statusCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }

  return error instanceof SyntaxError ? 400 : 500;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
