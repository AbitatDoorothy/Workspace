import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "../middleware";

describe("middleware public paths", () => {
  it("allows health checks without a browser session", async () => {
    const response = await middleware(new NextRequest("https://workspace.abitat.io/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("retires hosted mobile control APIs before they reach database-backed routes", async () => {
    const response = await middleware(
      new NextRequest("https://workspace.abitat.io/api/mobile/projects", {
        headers: {
          authorization: "Bearer paired_phone"
        }
      })
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error:
        "Hosted mobile control has been retired. Run abitat iphone on the Mac and pair the iPhone with the QR/manual payload from that local command."
    });
  });
});
