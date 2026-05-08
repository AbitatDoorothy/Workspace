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

  it("prefers explicit hosted CLI credentials over stale local config", () => {
    expect(
      resolveDaemonConnection({
        config: {
          apiUrl: "https://abitat.example",
          hostToken: "old_host_token",
          machineId: "machine_demo",
          workspaceId: "workspace_demo"
        },
        env: {
          ABITAT_API_URL: "https://workspace.abitat.io",
          ABITAT_HOST_TOKEN: "new_host_token",
          ABITAT_MACHINE_ID: "machine_live"
        }
      })
    ).toEqual({
      apiUrl: "https://workspace.abitat.io",
      hostToken: "new_host_token",
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
