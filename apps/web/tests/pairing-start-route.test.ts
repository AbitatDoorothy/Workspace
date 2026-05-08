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
  getRequestAccountContext
}));

describe("phone pairing start route", () => {
  beforeEach(() => {
    createPhonePairing.mockClear();
    getRequestAccountContext.mockClear();
  });

  it("uses the signed browser session user instead of caller-provided ownership fields", async () => {
    const sessionToken = await createSessionToken(
      "user_account",
      "test-secret",
      60_000,
      Date.now()
    );
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/mobile/pairing/start", {
        body: new URLSearchParams({
          workspaceId: "workspace_attacker",
          hostMachineId: "machine_attacker",
          createdByUserId: "user_attacker",
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
    expect(getRequestAccountContext).toHaveBeenCalled();
    expect(createPhonePairing).toHaveBeenCalledWith({
      workspaceId: "workspace_account",
      hostMachineId: "machine_account",
      createdByUserId: "user_account"
    });
  });
});
