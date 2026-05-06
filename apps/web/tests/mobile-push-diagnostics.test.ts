import { describe, expect, it } from "vitest";

import { formatMobilePushRegistrationDiagnostic } from "../server/mobile/mobile-push-diagnostics";

describe("mobile push diagnostics", () => {
  it("formats iPhone push registration failures with actor and stage context", () => {
    expect(
      formatMobilePushRegistrationDiagnostic({
        hostMachineId: "machine_demo",
        machineId: "machine_phone",
        message: "permission was not granted",
        stage: "permission",
        workspaceId: "workspace_demo"
      })
    ).toBe(
      "[mobile-push] iPhone push registration failed for phone machine_phone paired to host machine_demo in workspace workspace_demo at permission: permission was not granted"
    );
  });

  it("uses unknown when the phone has no paired host in diagnostics", () => {
    expect(
      formatMobilePushRegistrationDiagnostic({
        hostMachineId: null,
        machineId: "machine_phone",
        message: "missing project id",
        stage: "project-id",
        workspaceId: "workspace_demo"
      })
    ).toContain("paired to host unknown");
  });
});
