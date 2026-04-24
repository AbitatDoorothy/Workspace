import type {
  HostHeartbeatRequest,
  HostPairingRequest,
  HostPairingResponse,
  HostTool,
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
