import { describe, expect, it } from "vitest";

import { canUseLocalCodexApp } from "../server/mobile/codex-host-access";

describe("local Codex app access", () => {
  it("is disabled unless explicitly enabled for local development", async () => {
    await expect(
      canUseLocalCodexApp(
        { hostMachineId: "machine_demo", userId: "user_demo" },
        { ABITAT_MACHINE_ID: "machine_demo" }
      )
    ).resolves.toBe(false);
  });

  it("allows local Codex access when the local flag and host id match", async () => {
    await expect(
      canUseLocalCodexApp(
        { hostMachineId: "machine_demo", userId: "user_demo" },
        { ABITAT_ENABLE_LOCAL_CODEX_APP: "1", ABITAT_MACHINE_ID: "machine_demo" }
      )
    ).resolves.toBe(true);
  });

  it("allows local Codex access when the local flag and CLI user id match", async () => {
    await expect(
      canUseLocalCodexApp(
        { hostMachineId: "machine_registered", userId: "user_local" },
        { ABITAT_ENABLE_LOCAL_CODEX_APP: "1", ABITAT_LOCAL_CODEX_USER_ID: "user_local" }
      )
    ).resolves.toBe(true);
  });

  it("denies local Codex access when the local flag is enabled but the user id does not match", async () => {
    await expect(
      canUseLocalCodexApp(
        { hostMachineId: "machine_registered", userId: "user_friend" },
        { ABITAT_ENABLE_LOCAL_CODEX_APP: "1", ABITAT_LOCAL_CODEX_USER_ID: "user_local" }
      )
    ).resolves.toBe(false);
  });
});
