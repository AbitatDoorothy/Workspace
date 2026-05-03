import { afterEach, describe, expect, it, vi } from "vitest";

import { HostApiClient } from "../src/transport/api-client";

describe("HostApiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls remote-control sessions with host bearer auth", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ sessions: [] }));
    const client = new HostApiClient("https://workspace.example", "host_secret");

    await expect(client.pollRemoteControlSessions("machine_demo")).resolves.toEqual({
      sessions: []
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      new URL(
        "/api/remote-control/host/sessions?machineId=machine_demo",
        "https://workspace.example"
      ),
      {
        headers: {
          authorization: "Bearer host_secret"
        },
        method: "GET"
      }
    );
  });

  it("sends remote-control signals from the host", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ signal: {} }));
    const client = new HostApiClient("https://workspace.example", "host_secret");

    await client.sendRemoteControlSignal("remote_demo", {
      type: "answer",
      payload: { sdp: "v=0" }
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      new URL("/api/remote-control/host/sessions/remote_demo/signals", "https://workspace.example"),
      {
        body: JSON.stringify({ type: "answer", payload: { sdp: "v=0" } }),
        headers: {
          authorization: "Bearer host_secret",
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status: 200
  });
}
