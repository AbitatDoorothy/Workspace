export type IphoneTransport = "auto" | "local" | "tailscale" | "quick-tunnel" | "manual";

export interface IphoneStartupInput {
  codexServerUrl: string;
  endpoint?: string;
  port: number;
  transport: IphoneTransport;
}

export interface StartupProcess {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function createIphoneStartupPlan(input: IphoneStartupInput): StartupProcess[] {
  return [
    {
      name: "local-control-server",
      command: "abitat-host",
      args: [
        "iphone",
        "--port",
        String(input.port),
        "--transport",
        input.transport,
        "--codex-server-url",
        input.codexServerUrl,
        ...(input.endpoint ? ["--endpoint", input.endpoint] : [])
      ]
    }
  ];
}
