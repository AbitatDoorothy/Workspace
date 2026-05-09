import { beforeEach, describe, expect, it, vi } from "vitest";

const recoverStaleJobs = vi.hoisted(() => vi.fn(async () => 0));
const recordHeartbeat = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true as const,
    serverTime: "2026-05-09T05:00:00.000Z"
  }))
);

vi.mock("../server/conversations", () => ({
  conversationQueueService: {
    recoverStaleJobs
  }
}));

vi.mock("../server/hosts", () => ({
  hostService: {
    recordHeartbeat
  }
}));

describe("host heartbeat route", () => {
  beforeEach(() => {
    recoverStaleJobs.mockClear();
    recordHeartbeat.mockClear();
    vi.useRealTimers();
  });

  it("records host heartbeat", async () => {
    const { POST } = await import("../app/api/hosts/heartbeat/route");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/hosts/heartbeat", {
        body: JSON.stringify({
          machineId: "machine_1",
          status: "online"
        }),
        headers: {
          authorization: "Bearer host_secret"
        },
        method: "POST"
      })
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      serverTime: "2026-05-09T05:00:00.000Z"
    });
    expect(recordHeartbeat).toHaveBeenCalledWith(
      {
        machineId: "machine_1",
        status: "online"
      },
      "host_secret"
    );
  });

  it("does not fail heartbeat when stale job recovery stalls", async () => {
    vi.useFakeTimers();
    recoverStaleJobs.mockImplementationOnce(async () => new Promise(() => undefined));
    const { POST } = await import("../app/api/hosts/heartbeat/route");

    const responsePromise = POST(
      new Request("https://workspace.abitat.io/api/hosts/heartbeat", {
        body: JSON.stringify({
          machineId: "machine_1",
          status: "online"
        }),
        headers: {
          authorization: "Bearer host_secret"
        },
        method: "POST"
      })
    );
    await vi.advanceTimersByTimeAsync(1500);

    const response = await responsePromise;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      serverTime: "2026-05-09T05:00:00.000Z"
    });
  });
});
