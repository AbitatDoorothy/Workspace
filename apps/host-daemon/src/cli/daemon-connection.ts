import type { HostConfig } from "../config/host-config.js";

interface ResolveDaemonConnectionInput {
  config: HostConfig | null;
  env: Partial<Record<string, string | undefined>>;
}

export interface DaemonConnection {
  apiUrl: string;
  hostToken?: string;
  machineId: string;
  paired: boolean;
}

export function resolveDaemonConnection(input: ResolveDaemonConnectionInput): DaemonConnection {
  if (input.config) {
    return {
      apiUrl: input.config.apiUrl,
      hostToken: input.config.hostToken,
      machineId: input.config.machineId,
      paired: true
    };
  }

  return {
    apiUrl: input.env.ABITAT_API_URL ?? "http://localhost:3000",
    hostToken: input.env.ABITAT_HOST_TOKEN,
    machineId: input.env.ABITAT_MACHINE_ID ?? "machine_demo",
    paired: false
  };
}
