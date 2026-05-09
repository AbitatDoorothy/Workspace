import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/health/route";

const queryRaw = vi.hoisted(() => vi.fn(async () => [{ "?column?": 1 }]));

vi.mock("../server/db/client", () => ({
  databaseConnectionSource: "hyperdrive",
  prisma: {
    $queryRaw: queryRaw
  }
}));

describe("health route", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    vi.stubEnv("ABITAT_PUBLIC_URL", "https://workspace.abitat.io");
  });

  it("returns ok when the database responds", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      database: "ok",
      databaseConnectionSource: "hyperdrive",
      publicUrl: "https://workspace.abitat.io"
    });
  });

  it("returns unavailable when the database is unreachable", async () => {
    queryRaw.mockRejectedValue(new Error("connection refused"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      database: "error",
      databaseConnectionSource: "hyperdrive",
      publicUrl: "https://workspace.abitat.io"
    });
  });
});
