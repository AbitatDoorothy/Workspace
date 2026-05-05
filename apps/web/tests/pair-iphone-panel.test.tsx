import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createPhonePairingRedirectPath } from "../app/api/mobile/pairing/start/route";

describe("PairIphonePanel", () => {
  it("can create a pairing code without relying on client-side hydration", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/components/pair-iphone-panel.tsx"),
      "utf8"
    );

    expect(source).toContain('action="/api/mobile/pairing/start"');
    expect(source).toContain('method="post"');
    expect(source).toContain('name="hostMachineId"');
    expect(source).toContain('name="workspaceId"');
    expect(source).toContain('type="submit"');
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("onClick=");
  });

  it("redirects form-created pairing codes back to the pairing panel", () => {
    const path = createPhonePairingRedirectPath("/#pair-iphone", {
      code: "ABITAT-202479",
      expiresAt: "2026-05-05T12:26:30.424Z",
      qrPayload: "abitat://pair?code=ABITAT-202479"
    });
    const url = new URL(path, "http://abitat.local");

    expect(url.pathname).toBe("/");
    expect(url.hash).toBe("#pair-iphone");
    expect(url.searchParams.get("iphonePairingCode")).toBe("ABITAT-202479");
    expect(url.searchParams.get("iphonePairingQrPayload")).toBe("abitat://pair?code=ABITAT-202479");
  });
});
