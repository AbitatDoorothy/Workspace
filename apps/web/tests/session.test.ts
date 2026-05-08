import { describe, expect, it } from "vitest";

import {
  createBrowserRedirectUrl,
  createSessionToken,
  createPublicRedirectUrl,
  isSecureRequest,
  sanitizeRedirectPath,
  verifySessionToken
} from "../server/auth/session";
import { hashPassword, verifyPassword } from "../server/auth/passwords";

describe("auth session", () => {
  it("creates a signed session token containing the authenticated user id", async () => {
    const token = await createSessionToken("user_123", "secret", 60_000, 1_800_000_000_000);

    await expect(verifySessionToken(token, "secret", 1_700_000_000_000)).resolves.toEqual({
      userId: "user_123"
    });
  });

  it("rejects tampered or expired session tokens", async () => {
    const token = await createSessionToken("user_123", "secret", 60_000, 1_800_000_000_000);

    await expect(verifySessionToken(`${token}x`, "secret", 1_700_000_000_000)).resolves.toBe(false);
    await expect(verifySessionToken(token, "secret", 1_800_000_060_001)).resolves.toBe(false);
  });

  it("hashes and verifies account passwords without storing plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple", {
      salt: Buffer.from("0123456789abcdef0123456789abcdef")
    });

    expect(hash).not.toContain("correct horse");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
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
