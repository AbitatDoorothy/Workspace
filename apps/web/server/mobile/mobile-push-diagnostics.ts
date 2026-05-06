interface PushRegistrationDiagnosticInput {
  hostMachineId: string | null;
  machineId: string;
  message: string;
  stage: string;
  workspaceId: string;
}

export function formatMobilePushRegistrationDiagnostic(input: PushRegistrationDiagnosticInput) {
  return [
    "[mobile-push] iPhone push registration failed for phone",
    sanitizeDiagnosticText(input.machineId),
    "paired to host",
    sanitizeDiagnosticText(input.hostMachineId ?? "unknown"),
    "in workspace",
    sanitizeDiagnosticText(input.workspaceId),
    "at",
    `${sanitizeDiagnosticText(input.stage)}:`,
    sanitizeDiagnosticText(input.message)
  ].join(" ");
}

function sanitizeDiagnosticText(value: string) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, 500) : "unknown";
}
