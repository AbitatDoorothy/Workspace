import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/mobile/pairing/start/route";
import { SESSION_COOKIE_NAME, createSessionToken } from "../server/auth/session";

const createPhonePairing = vi.hoisted(() =>
  vi.fn(async () => ({
    pairingId: "pairing_1",
    code: "ABITAT-654321",
    expiresAt: "2026-05-07T12:05:00.000Z",
    qrPayload: "abitat://pair?code=ABITAT-654321"
  }))
);

const getRequestAccountContext = vi.hoisted(() =>
  vi.fn(async () => ({
    hostMachineId: "machine_account",
    userId: "user_account",
    workspaceId: "workspace_account"
  }))
);
const getRequestSessionUserId = vi.hoisted(() => vi.fn(async () => "user_account"));

vi.mock("../server/mobile", () => ({
  mobileService: {
    createPhonePairing
  }
}));

vi.mock("../server/mobile/mobile-activity-log", () => ({
  mobileActivityLog: {
    record: vi.fn()
  }
}));

vi.mock("../server/auth/request-session", () => ({
  getRequestAccountContext,
  getRequestSessionUserId
}));

describe("phone pairing start route", () => {
  beforeEach(() => {
    createPhonePairing.mockClear();
    getRequestAccountContext.mockClear();
    getRequestSessionUserId.mockClear();
  });

  it("uses the signed browser session user with the submitted host target", async () => {
    const sessionToken = await createSessionToken(
      "user_account",
      "test-secret",
      60_000,
      Date.now()
    );
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/mobile/pairing/start", {
        body: new URLSearchParams({
          workspaceId: "workspace_fresh",
          hostMachineId: "machine_fresh",
          createdByUserId: "user_ignored",
          redirectTo: "/#pair-iphone"
        }),
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(303);
    expect(getRequestAccountContext).not.toHaveBeenCalled();
    expect(getRequestSessionUserId).toHaveBeenCalled();
    expect(createPhonePairing).toHaveBeenCalledWith({
      workspaceId: "workspace_fresh",
      hostMachineId: "machine_fresh",
      createdByUserId: "user_account",
      skipHostLookup: true
    });
  });

  it("allows JSON callers to pass the freshly registered host target", async () => {
    const sessionToken = await createSessionToken(
      "user_account",
      "test-secret",
      60_000,
      Date.now()
    );
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/mobile/pairing/start", {
        body: JSON.stringify({
          workspaceId: "workspace_fresh",
          hostMachineId: "machine_fresh"
        }),
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(201);
    expect(getRequestAccountContext).not.toHaveBeenCalled();
    expect(getRequestSessionUserId).toHaveBeenCalled();
    expect(createPhonePairing).toHaveBeenCalledWith({
      workspaceId: "workspace_fresh",
      hostMachineId: "machine_fresh",
      createdByUserId: "user_account",
      skipHostLookup: true
    });
  });

  it("returns service unavailable when account context lookup times out", async () => {
    getRequestAccountContext.mockRejectedValueOnce(
      new Error("account_context_find_workspace timed out after 5000ms")
    );

    const response = await POST(
      new Request("http://127.0.0.1:3000/api/mobile/pairing/start", {
        body: new URLSearchParams({
          redirectTo: "/#pair-iphone"
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "account_context_find_workspace timed out after 5000ms"
    });
  });
});
