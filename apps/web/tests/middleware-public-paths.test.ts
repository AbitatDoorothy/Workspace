import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "../middleware";

describe("middleware public paths", () => {
  it("allows health checks without a browser session", async () => {
    const response = await middleware(new NextRequest("https://workspace.abitat.io/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
