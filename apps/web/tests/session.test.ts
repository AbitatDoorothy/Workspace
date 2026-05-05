import { describe, expect, it } from "vitest";

import {
  createBrowserRedirectUrl,
  createSessionToken,
  createPublicRedirectUrl,
  isSecureRequest,
  sanitizeRedirectPath,
  verifyLoginPassword,
  verifySessionToken
} from "../server/auth/session";

describe("auth session", () => {
  it("creates a signed session token that verifies with the same secret", async () => {
    const token = await createSessionToken("secret", 60_000, 1_800_000_000_000);

    await expect(verifySessionToken(token, "secret", 1_700_000_000_000)).resolves.toBe(true);
  });

  it("rejects tampered or expired session tokens", async () => {
    const token = await createSessionToken("secret", 60_000, 1_800_000_000_000);

    await expect(verifySessionToken(`${token}x`, "secret", 1_700_000_000_000)).resolves.toBe(false);
    await expect(verifySessionToken(token, "secret", 1_800_000_060_001)).resolves.toBe(false);
  });

  it("verifies the configured login password without trimming real characters", () => {
    expect(verifyLoginPassword("correct horse", "correct horse")).toBe(true);
    expect(verifyLoginPassword("correct horse ", "correct horse")).toBe(false);
  });

  it("builds redirects from forwarded public hosts instead of the local origin", () => {
    const request = new Request("http://127.0.0.1:3000/api/login", {
      headers: {
        "x-forwarded-host": "workspace.abitat.io",
        "x-forwarded-proto": "https"
      }
    });

    expect(createPublicRedirectUrl(request, "/login?error=1").toString()).toBe(
      "https://workspace.abitat.io/login?error=1"
    );
  });

  it("uses the configured public URL when the request still looks local", () => {
    const request = new Request("http://localhost:3000/api/logout");

    expect(
      createPublicRedirectUrl(request, "/login", {
        ABITAT_PUBLIC_URL: "https://workspace.abitat.io"
      }).toString()
    ).toBe("https://workspace.abitat.io/login");
  });

  it("keeps browser redirects on the current origin even when a public phone URL is configured", () => {
    const request = new Request("http://127.0.0.1:3901/api/mobile/pairing/start");

    expect(
      createBrowserRedirectUrl(request, "/?iphonePairingCode=ABITAT-202479#pair-iphone").toString()
    ).toBe("http://127.0.0.1:3901/?iphonePairingCode=ABITAT-202479#pair-iphone");
  });

  it("does not mark local http browser sessions secure just because a remote phone URL is configured", () => {
    const request = new Request("http://127.0.0.1:3000/api/login");

    expect(
      isSecureRequest(request, {
        ABITAT_PUBLIC_URL: "https://workspace.abitat.io"
      })
    ).toBe(false);
  });

  it("marks tunnel-forwarded browser sessions secure", () => {
    const request = new Request("http://127.0.0.1:3000/api/login", {
      headers: {
        "x-forwarded-proto": "https"
      }
    });

    expect(isSecureRequest(request)).toBe(true);
  });

  it("keeps only local redirect paths for post-login next destinations", () => {
    expect(sanitizeRedirectPath("/projects/project_123?tab=queue")).toBe(
      "/projects/project_123?tab=queue"
    );
    expect(sanitizeRedirectPath("https://evil.test/projects")).toBe("/");
    expect(sanitizeRedirectPath("//evil.test/projects")).toBe("/");
    expect(sanitizeRedirectPath("projects/project_123")).toBe("/");
  });
});
