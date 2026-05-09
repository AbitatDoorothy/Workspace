import { beforeEach, describe, expect, it, vi } from "vitest";

const recoverStaleJobs = vi.hoisted(() => vi.fn(async () => 0));
const pollNextJob = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
const requireHostToken = vi.hoisted(() => vi.fn(async () => "host_secret"));

vi.mock("../server/conversations", () => ({
  conversationQueueService: {
    pollNextJob,
    recoverStaleJobs
  }
}));

vi.mock("../server/hosts/request-auth", () => ({
  requireHostToken
}));

describe("daemon job poll route", () => {
  beforeEach(() => {
    pollNextJob.mockReset();
    pollNextJob.mockResolvedValue(null);
    recoverStaleJobs.mockReset();
    recoverStaleJobs.mockResolvedValue(0);
    requireHostToken.mockReset();
    requireHostToken.mockResolvedValue("host_secret");
    vi.useRealTimers();
  });

  it("polls daemon jobs after authenticating the host", async () => {
    pollNextJob.mockResolvedValueOnce({
      id: "job_1",
      type: "start_conversation",
      conversationId: "conversation_1",
      payload: {}
    });
    const { POST } = await import("../app/api/daemon/jobs/poll/route");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/daemon/jobs/poll", {
        body: JSON.stringify({
          machineId: "machine_1"
        }),
        headers: {
          authorization: "Bearer host_secret"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      job: {
        id: "job_1",
        type: "start_conversation",
        conversationId: "conversation_1",
        payload: {}
      }
    });
    expect(requireHostToken).toHaveBeenCalledWith(expect.any(Request), "machine_1");
    expect(recoverStaleJobs).toHaveBeenCalledWith("machine_1", {
      activeConversationId: undefined,
      activeConversationIds: undefined
    });
    expect(pollNextJob).toHaveBeenCalledWith("machine_1");
  });

  it("does not fail polling when stale job recovery stalls", async () => {
    vi.useFakeTimers();
    recoverStaleJobs.mockImplementationOnce(async () => new Promise(() => undefined));
    const { POST } = await import("../app/api/daemon/jobs/poll/route");

    const responsePromise = POST(
      new Request("https://workspace.abitat.io/api/daemon/jobs/poll", {
        body: JSON.stringify({
          machineId: "machine_1"
        }),
        method: "POST"
      })
    );
    await vi.advanceTimersByTimeAsync(1500);

    const response = await responsePromise;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: null });
    expect(pollNextJob).toHaveBeenCalledWith("machine_1");
  });

  it("returns no job when the job poll query times out", async () => {
    pollNextJob.mockRejectedValueOnce(new Error("Query read timeout"));
    const { POST } = await import("../app/api/daemon/jobs/poll/route");

    const response = await POST(
      new Request("https://workspace.abitat.io/api/daemon/jobs/poll", {
        body: JSON.stringify({
          machineId: "machine_1"
        }),
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: null });
  });
});
