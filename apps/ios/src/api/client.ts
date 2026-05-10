import * as Crypto from "expo-crypto";

import {
  decryptRelayEnvelope,
  encryptRelayEnvelope,
  relaySessionKey,
  sha256Hex,
  type RelayEncryptedEnvelope,
  type RelayPlainResponse
} from "@abitat_reece/shared";

import type {
  CodexCompletionSummary,
  CodexModelOption,
  CodexReasoningEffort,
  ConversationAttachment,
  ConversationMessage,
  ConversationSummary,
  GeneratedFileDownload,
  GeneratedFileSummary,
  LocalPairingPayload,
  MobileBootstrap,
  PairingState,
  ProjectSummary,
  RemoteControlSignal,
  RemoteControlSession
} from "../types";

export interface ApiClient {
  bootstrap(): Promise<MobileBootstrap>;
  completePairing(input: {
    appVersion: string;
    code: string;
    deviceName: string;
    endpoint?: string;
    pairingSecret?: string;
    relayId?: string;
    transport?: LocalPairingPayload["transport"];
  }): Promise<PairingState>;
  continueConversation(
    conversationId: string,
    input: {
      attachments?: Pick<ConversationAttachment, "kind" | "name" | "path">[];
      clientMessageId: string;
      effort?: CodexReasoningEffort;
      model?: string;
      prompt: string;
    }
  ): Promise<{ conversationId: string; status: string }>;
  createConversation(
    projectId: string,
    input: {
      attachments?: Pick<ConversationAttachment, "kind" | "name" | "path">[];
      clientMessageId: string;
      effort?: CodexReasoningEffort;
      model?: string;
      prompt: string;
    }
  ): Promise<{ conversationId: string; status: string }>;
  createRemoteSession(hostMachineId: string): Promise<RemoteControlSession>;
  endRemoteSession(sessionId: string): Promise<RemoteControlSession>;
  listConversations(projectId: string): Promise<ConversationSummary[]>;
  listCompletionStates(): Promise<CodexCompletionSummary[]>;
  listCodexModels(): Promise<CodexModelOption[]>;
  listGeneratedFiles(conversationId: string): Promise<GeneratedFileSummary[]>;
  listMessages(
    conversationId: string,
    afterSequence?: number,
    options?: { includeRuntime?: boolean }
  ): Promise<ConversationMessage[]>;
  downloadGeneratedFile(conversationId: string, fileId: string): Promise<GeneratedFileDownload>;
  listProjects(): Promise<ProjectSummary[]>;
  listRemoteSignals(sessionId: string): Promise<RemoteControlSignal[]>;
  registerPushToken(input: { platform: "ios"; provider: "expo"; token: string }): Promise<void>;
  reportPushRegistrationIssue(input: { message: string; stage: string }): Promise<void>;
  sendRemoteSignal(
    sessionId: string,
    input: { type: string; payload: Record<string, unknown>; recipientMachineId?: string }
  ): Promise<void>;
  uploadAttachment(input: {
    dataBase64: string;
    fileName: string;
    mimeType: string;
  }): Promise<ConversationAttachment>;
}

export function createApiClient(pairing: PairingState): ApiClient {
  return {
    bootstrap: () => get(pairing, "/api/mobile/bootstrap").then((body) => body as MobileBootstrap),
    async completePairing(input) {
      const endpoint = input.endpoint ?? pairing.apiUrl;
      const requestBody = {
        appVersion: input.appVersion,
        code: input.code,
        deviceName: input.deviceName,
        pairingSecret: input.pairingSecret,
        platform: "ios"
      };
      const response = (
        input.transport === "relay" && input.relayId && input.pairingSecret
          ? relayBodyOrThrow(
              await postRelay(endpoint, input.relayId, sha256Hex(input.pairingSecret), {
                body: requestBody,
                method: "POST",
                path: "/pairing/consume"
              })
            )
          : await postUnauthed(endpoint, "/pairing/consume", requestBody)
      ) as Record<string, string>;

      return {
        apiUrl: endpoint,
        clientToken: response.clientToken,
        hostMachineId: response.hostMachineId,
        macId: response.macId ?? response.hostMachineId,
        machineId: response.machineId,
        relayId: input.relayId,
        transport: input.transport,
        workspaceId: response.workspaceId
      };
    },
    continueConversation: (conversationId, input) =>
      post(pairing, `/api/mobile/conversations/${conversationId}/continue`, input).then(
        (body) => body as { conversationId: string; status: string }
      ),
    createConversation: (projectId, input) =>
      post(pairing, `/api/mobile/projects/${projectId}/conversations`, input).then(
        (body) => body as { conversationId: string; status: string }
      ),
    createRemoteSession: (hostMachineId) =>
      post(pairing, "/api/remote-control/sessions", {
        hostMachineId,
        inputEnabled: true,
        screenEnabled: true
      }).then((body) => body.session as RemoteControlSession),
    endRemoteSession: (sessionId) =>
      del(pairing, `/api/remote-control/sessions/${sessionId}`).then(
        (body) => body.session as RemoteControlSession
      ),
    listConversations: (projectId) =>
      get(pairing, `/api/mobile/projects/${projectId}/conversations`).then(
        (body) => body.conversations as ConversationSummary[]
      ),
    listCompletionStates: () =>
      get(pairing, "/api/mobile/codex/completions").then(
        (body) => body.completions as CodexCompletionSummary[]
      ),
    listCodexModels: () =>
      get(pairing, "/api/mobile/codex/models").then((body) => body.models as CodexModelOption[]),
    listGeneratedFiles: (conversationId) =>
      get(pairing, `/api/mobile/conversations/${conversationId}/files`).then(
        (body) => body.files as GeneratedFileSummary[]
      ),
    listMessages: (conversationId, afterSequence, options) =>
      get(pairing, mobileMessagesPath(conversationId, afterSequence, options)).then(
        (body) => body.messages as ConversationMessage[]
      ),
    downloadGeneratedFile: (conversationId, fileId) =>
      get(pairing, `/api/mobile/conversations/${conversationId}/files/${fileId}/download`).then(
        (body) => body.file as GeneratedFileDownload
      ),
    listProjects: () =>
      get(pairing, "/api/mobile/projects").then((body) => body.projects as ProjectSummary[]),
    listRemoteSignals: (sessionId) =>
      get(pairing, `/api/remote-control/sessions/${sessionId}/signals`).then(
        (body) => body.signals as RemoteControlSignal[]
      ),
    registerPushToken: (input) =>
      post(pairing, "/api/mobile/notifications/register", input).then(() => undefined),
    reportPushRegistrationIssue: (input) =>
      post(pairing, "/api/mobile/notifications/diagnostics", input).then(() => undefined),
    sendRemoteSignal: (sessionId, input) =>
      post(pairing, `/api/remote-control/sessions/${sessionId}/signals`, input).then(
        () => undefined
      ),
    uploadAttachment: (input) =>
      post(pairing, "/api/mobile/attachments", input).then(
        (body) => body.attachment as ConversationAttachment
      )
  };
}

export function createPairingClient(apiUrl: string) {
  const bootstrapPairing: PairingState = {
    apiUrl,
    clientToken: "",
    hostMachineId: "",
    machineId: "",
    workspaceId: ""
  };

  return createApiClient(bootstrapPairing);
}

export function parsePairingPayload(value: string): LocalPairingPayload | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parsePairingPayloadJson(trimmed) ?? parsePairingPayloadUrl(trimmed);
  if (!parsed || parsed.product !== "abitat" || parsed.version !== 1) {
    return null;
  }

  if (!parsed.endpoint || !parsed.macId || !parsed.pairingSecret) {
    return null;
  }

  return parsed;
}

async function get(pairing: PairingState, path: string) {
  return request(pairing, path, { method: "GET" });
}

async function post(pairing: PairingState, path: string, body: unknown) {
  return request(pairing, path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
}

async function del(pairing: PairingState, path: string) {
  return request(pairing, path, { method: "DELETE" });
}

async function request(pairing: PairingState, path: string, init: RequestInit) {
  if (pairing.transport === "relay" && pairing.relayId) {
    return relayRequest(pairing, path, init);
  }

  const response = await fetch(new URL(path, pairing.apiUrl).toString(), {
    ...init,
    headers: {
      authorization: `Bearer ${pairing.clientToken}`,
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await readableError(response));
  }

  return readJsonBody(response, path) as Promise<Record<string, any>>;
}

async function relayRequest(pairing: PairingState, path: string, init: RequestInit) {
  const response = await postRelay(
    pairing.apiUrl,
    pairing.relayId ?? "",
    sha256Hex(pairing.clientToken),
    {
      body: parseRequestBody(init.body),
      headers: {
        authorization: `Bearer ${pairing.clientToken}`,
        ...headersObject(init.headers)
      },
      method: init.method ?? "GET",
      path
    }
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(readableRelayError(response));
  }

  return response.body as Record<string, any>;
}

async function postRelay(
  apiUrl: string,
  relayId: string,
  keyMaterial: string,
  request: {
    body?: unknown;
    headers?: Record<string, string>;
    method: string;
    path: string;
  }
) {
  const key = await relaySessionKey(keyMaterial, relayId);
  const requestId = createRequestId();
  const envelope = await encryptRelayEnvelope(
    key,
    {
      ...request,
      requestId
    },
    { nonce: Crypto.getRandomBytes(12) }
  );
  const response = await fetch(
    new URL(`/relay/${encodeURIComponent(relayId)}/request`, apiUrl).toString(),
    {
      body: JSON.stringify({ envelope }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }
  );

  if (!response.ok) {
    throw new Error(await readableError(response));
  }

  const relayBody = (await readJsonBody(response, `/relay/${relayId}/request`)) as {
    envelope?: RelayEncryptedEnvelope;
  };
  if (!relayBody.envelope) {
    throw new Error("Relay response did not include an envelope");
  }

  return decryptRelayEnvelope<RelayPlainResponse>(key, relayBody.envelope);
}

async function postUnauthed(apiUrl: string, path: string, body: unknown) {
  const response = await fetch(new URL(path, apiUrl).toString(), {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await readableError(response));
  }

  return readJsonBody(response, path) as Promise<Record<string, string>>;
}

function parsePairingPayloadJson(value: string): LocalPairingPayload | null {
  if (!value.startsWith("{")) {
    return null;
  }

  try {
    return normalizePairingPayload(JSON.parse(value) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function parsePairingPayloadUrl(value: string): LocalPairingPayload | null {
  if (!value.startsWith("abitat://")) {
    return null;
  }

  const params = parseQuery(value.split("?")[1] ?? "");
  return normalizePairingPayload({
    version: Number(params.version ?? "1"),
    product: params.product ?? "abitat",
    endpoint: params.endpoint,
    macId: params.macId,
    pairingSecret: params.pairingSecret,
    manualCode: params.manualCode ?? params.code,
    relayId: params.relayId,
    expiresAt: params.expiresAt,
    transport: params.transport ?? "manual"
  });
}

function normalizePairingPayload(value: Record<string, unknown>): LocalPairingPayload | null {
  const transport = value.transport;
  if (
    transport !== "local" &&
    transport !== "tailscale" &&
    transport !== "quick-tunnel" &&
    transport !== "manual" &&
    transport !== "relay"
  ) {
    return null;
  }

  if (
    value.version !== 1 ||
    value.product !== "abitat" ||
    typeof value.endpoint !== "string" ||
    typeof value.macId !== "string" ||
    typeof value.pairingSecret !== "string" ||
    typeof value.expiresAt !== "string"
  ) {
    return null;
  }

  return {
    version: 1,
    product: "abitat",
    endpoint: value.endpoint,
    macId: value.macId,
    pairingSecret: value.pairingSecret,
    manualCode: typeof value.manualCode === "string" ? value.manualCode : undefined,
    relayId: typeof value.relayId === "string" ? value.relayId : undefined,
    expiresAt: value.expiresAt,
    transport,
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.filter(
          (capability): capability is string => typeof capability === "string"
        )
      : []
  };
}

function parseQuery(query: string) {
  return Object.fromEntries(
    query
      .split("&")
      .filter(Boolean)
      .map((part) => {
        const [rawKey, rawValue = ""] = part.split("=");
        return [decodeURIComponent(rawKey), decodeURIComponent(rawValue.replace(/\+/g, " "))];
      })
  ) as Record<string, string>;
}

function relayBodyOrThrow(response: RelayPlainResponse) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(readableRelayError(response));
  }

  return response.body;
}

function parseRequestBody(body: RequestInit["body"] | null | undefined) {
  if (typeof body !== "string" || !body.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function headersObject(headers: RequestInit["headers"] | undefined) {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries((headers as any).entries()) as Record<string, string>;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

function readableRelayError(response: RelayPlainResponse) {
  if (typeof response.body === "string" && response.body.trim()) {
    return response.body;
  }

  if (
    response.body &&
    typeof response.body === "object" &&
    "error" in response.body &&
    typeof response.body.error === "string"
  ) {
    return response.body.error;
  }

  return `${response.status} Relay response`;
}

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

async function readableError(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return `${response.status} ${response.statusText}`;
  }

  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error ?? `${response.status} ${response.statusText}`;
  } catch {
    if (isHtmlError(text)) {
      return `${response.status} ${response.statusText || "Server error"}`;
    }
    return text;
  }
}

async function readJsonBody(response: Response, path: string) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`Empty response from ${path}`);
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid JSON response from ${path}: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isHtmlError(text: string) {
  const preview = text.slice(0, 300).toLowerCase();
  return preview.includes("<!doctype html") || preview.includes("<html");
}

function mobileMessagesPath(
  conversationId: string,
  afterSequence?: number,
  options: { includeRuntime?: boolean } = {}
) {
  const params: string[] = [];

  if (typeof afterSequence === "number") {
    params.push(`afterSequence=${encodeURIComponent(String(afterSequence))}`);
  }

  if (options.includeRuntime) {
    params.push("includeRuntime=true");
  }

  const query = params.join("&");
  return `/api/mobile/conversations/${conversationId}/messages${query ? `?${query}` : ""}`;
}
