import type {
  DaemonJobAckRequest,
  DaemonJobPollResponse,
  HostHeartbeatRequest,
  HostPairingRequest,
  HostPairingResponse,
  HostTool,
  RunEventIngestRequest,
  ToolScanUploadRequest
} from "@abitat/shared";

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
