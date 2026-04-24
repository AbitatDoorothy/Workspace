import { describe, expect, it } from "vitest";

import { resolveDaemonConnection } from "../src/cli/daemon-connection";

describe("resolveDaemonConnection", () => {
  it("uses the paired host config when available", () => {
    expect(
      resolveDaemonConnection({
        config: {
          apiUrl: "https://abitat.example",
          hostToken: "host_token",
          machineId: "machine_live",
          workspaceId: "workspace_live"
        },
        env: {}
      })
    ).toEqual({
      apiUrl: "https://abitat.example",
      hostToken: "host_token",
      machineId: "machine_live",
      paired: true
    });
  });

  it("falls back to demo polling when no host config exists", () => {
    expect(resolveDaemonConnection({ config: null, env: {} })).toEqual({
      apiUrl: "http://localhost:3000",
      hostToken: undefined,
      machineId: "machine_demo",
      paired: false
    });
  });
});
