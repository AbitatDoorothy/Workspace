import type {
  DaemonJobAckRequest,
  DaemonJobPollResponse,
  HostHeartbeatRequest,
  HostPairingRequest,
  HostPairingResponse,
  HostTool,
  RemoteControlStatus,
  RunEventIngestRequest,
  ToolScanUploadRequest
} from "@abitat/shared";

interface RemoteControlSessionSummary {
  id: string;
  status: RemoteControlStatus;
  hostMachineId: string;
  clientMachineId: string;
  screenEnabled: boolean;
  inputEnabled: boolean;
  errorMessage?: string | null;
}

interface RemoteControlSignalSummary {
  id: string;
  sessionId: string;
  senderMachineId: string;
  recipientMachineId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class HostApiClient {
  constructor(
    private readonly apiUrl: string,
    private readonly hostToken?: string
  ) {}

  pair(input: HostPairingRequest) {
    return this.post<HostPairingResponse>("/api/hosts/pair", input);
  }

  heartbeat(input: HostHeartbeatRequest) {
    return this.post<{ ok: true; serverTime: string }>("/api/hosts/heartbeat", input);
  }

  uploadTools(machineId: string, tools: HostTool[]) {
    const input: ToolScanUploadRequest = { machineId, tools };
    return this.post<{ ok: true }>("/api/hosts/tools", input);
  }

  pollJob(machineId: string, activeConversationIds?: string | string[]) {
    const activeIds = Array.isArray(activeConversationIds)
      ? activeConversationIds
      : activeConversationIds
        ? [activeConversationIds]
        : [];

    return this.post<DaemonJobPollResponse>("/api/daemon/jobs/poll", {
      machineId,
      ...(activeIds[0] ? { activeConversationId: activeIds[0] } : {}),
      ...(activeIds.length > 0 ? { activeConversationIds: activeIds } : {})
    });
  }

  ackJob(jobId: string, input: DaemonJobAckRequest) {
    return this.post<{ ok: true }>(`/api/daemon/jobs/${jobId}/ack`, input);
  }

  ingestRunEvent(conversationId: string, input: RunEventIngestRequest) {
    return this.post<{ ok: true }>(`/api/conversations/${conversationId}/events`, input);
  }

  uploadChangeSet(
    conversationId: string,
    input: { filesChanged: string[]; diffText: string; summary: string }
  ) {
    return this.post<{ ok: true }>(`/api/conversations/${conversationId}/changeset`, input);
  }

  pollRemoteControlSessions(machineId: string) {
    const path = `/api/remote-control/host/sessions?machineId=${encodeURIComponent(machineId)}`;
    return this.get<{ sessions: RemoteControlSessionSummary[] }>(path);
  }

  updateRemoteControlSession(
    sessionId: string,
    input: { status: RemoteControlStatus; errorMessage?: string }
  ) {
    return this.patch<{ session: RemoteControlSessionSummary }>(
      `/api/remote-control/host/sessions/${sessionId}`,
      input
    );
  }

  listRemoteControlSignals(sessionId: string) {
    return this.get<{ signals: RemoteControlSignalSummary[] }>(
      `/api/remote-control/host/sessions/${sessionId}/signals`
    );
  }

  sendRemoteControlSignal(
    sessionId: string,
    input: { type: string; payload: Record<string, unknown>; recipientMachineId?: string }
  ) {
    return this.post<{ signal: RemoteControlSignalSummary }>(
      `/api/remote-control/host/sessions/${sessionId}/signals`,
      input
    );
  }

  private async get<TResponse>(path: string) {
    const response = await fetch(new URL(path, this.apiUrl), {
      method: "GET",
      headers: {
        ...(this.hostToken ? { authorization: `Bearer ${this.hostToken}` } : {})
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    return (await response.json()) as TResponse;
  }

  private async patch<TResponse>(path: string, body: unknown) {
    const response = await fetch(new URL(path, this.apiUrl), {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(this.hostToken ? { authorization: `Bearer ${this.hostToken}` } : {})
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    return (await response.json()) as TResponse;
  }

  private async post<TResponse>(path: string, body: unknown) {
    const response = await fetch(new URL(path, this.apiUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.hostToken ? { authorization: `Bearer ${this.hostToken}` } : {})
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    return (await response.json()) as TResponse;
  }
}
