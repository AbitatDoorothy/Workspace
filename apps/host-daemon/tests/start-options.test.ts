import { describe, expect, it } from "vitest";

import { parseStartOptions } from "../src/cli/start-options";

describe("parseStartOptions", () => {
  it("enables mock mode for the Phase 0 daemon dev command", () => {
    expect(parseStartOptions(["start", "--mock"])).toEqual({ mock: true });
  });
});
