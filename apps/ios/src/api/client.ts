import type {
  CodexCompletionSummary,
  ConversationMessage,
  ConversationSummary,
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
  }): Promise<PairingState>;
  continueConversation(
    conversationId: string,
    input: { prompt: string; clientMessageId: string }
  ): Promise<{ conversationId: string; status: string }>;
  createConversation(
    projectId: string,
    input: { prompt: string; clientMessageId: string }
  ): Promise<{ conversationId: string; status: string }>;
  createRemoteSession(hostMachineId: string): Promise<RemoteControlSession>;
  endRemoteSession(sessionId: string): Promise<RemoteControlSession>;
  listConversations(projectId: string): Promise<ConversationSummary[]>;
  listCompletionStates(): Promise<CodexCompletionSummary[]>;
  listMessages(conversationId: string, afterSequence?: number): Promise<ConversationMessage[]>;
  listProjects(): Promise<ProjectSummary[]>;
  listRemoteSignals(sessionId: string): Promise<RemoteControlSignal[]>;
  registerPushToken(input: { platform: "ios"; provider: "expo"; token: string }): Promise<void>;
  reportPushRegistrationIssue(input: { message: string; stage: string }): Promise<void>;
  sendRemoteSignal(
    sessionId: string,
    input: { type: string; payload: Record<string, unknown>; recipientMachineId?: string }
  ): Promise<void>;
}

export function createApiClient(pairing: PairingState): ApiClient {
  return {
    bootstrap: () => get(pairing, "/api/mobile/bootstrap").then((body) => body as MobileBootstrap),
    async completePairing(input) {
      const response = await postUnauthed(pairing.apiUrl, "/api/mobile/pairing/complete", {
        appVersion: input.appVersion,
        code: input.code,
        deviceName: input.deviceName,
        platform: "ios"
      });

      return {
        apiUrl: pairing.apiUrl,
        clientToken: response.clientToken,
        hostMachineId: response.hostMachineId,
        machineId: response.machineId,
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
    listMessages: (conversationId, afterSequence) =>
      get(
        pairing,
        `/api/mobile/conversations/${conversationId}/messages${
          afterSequence ? `?afterSequence=${afterSequence}` : ""
        }`
      ).then((body) => body.messages as ConversationMessage[]),
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

  return response.json() as Promise<Record<string, any>>;
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

  return response.json() as Promise<Record<string, string>>;
}

async function readableError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
