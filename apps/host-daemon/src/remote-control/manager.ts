import { spawn } from "node:child_process";

import type { RemoteControlStatus } from "@abitat/shared";

export interface RemoteControlSessionSummary {
  id: string;
  status: RemoteControlStatus;
  hostMachineId: string;
  clientMachineId: string;
  screenEnabled: boolean;
  inputEnabled: boolean;
  errorMessage?: string | null;
}

export interface RemoteControlClient {
  pollRemoteControlSessions(
    machineId: string
  ): Promise<{ sessions: RemoteControlSessionSummary[] }>;
  updateRemoteControlSession(
    sessionId: string,
    input: { status: RemoteControlStatus; errorMessage?: string }
  ): Promise<{ session: RemoteControlSessionSummary }>;
}

export interface RemoteControlHelperInput {
  apiUrl: string;
  clientMachineId: string;
  helperPath: string;
  hostToken?: string;
  inputEnabled: boolean;
  screenEnabled: boolean;
  sessionId: string;
}

export interface RemoteControlHelperProcess {
  kill(): void;
  onExit(handler: (exitCode: number | null) => void): void;
}

interface RemoteControlManagerOptions {
  apiUrl: string;
  helperPath?: string;
  hostToken?: string;
  spawnHelper?: (input: RemoteControlHelperInput) => RemoteControlHelperProcess;
}

const startableStatuses = new Set<RemoteControlStatus>(["requested", "connecting", "active"]);
const stoppedStatuses = new Set<RemoteControlStatus>(["ended", "failed"]);

export function createRemoteControlManager(
  client: RemoteControlClient,
  options: RemoteControlManagerOptions
) {
  const activeHelpers = new Map<string, RemoteControlHelperProcess>();
  const spawnHelper = options.spawnHelper ?? defaultSpawnHelper;

  return {
    async tick(machineId: string) {
      const { sessions } = await client.pollRemoteControlSessions(machineId);

      for (const session of sessions) {
        if (stoppedStatuses.has(session.status)) {
          stopHelper(activeHelpers, session.id);
          continue;
        }

        if (!startableStatuses.has(session.status) || activeHelpers.has(session.id)) {
          continue;
        }

        if (!options.helperPath) {
          await client.updateRemoteControlSession(session.id, {
            status: "failed",
            errorMessage: "Remote-control helper is not configured"
          });
          continue;
        }

        const helper = spawnHelper({
          apiUrl: options.apiUrl,
          clientMachineId: session.clientMachineId,
          helperPath: options.helperPath,
          hostToken: options.hostToken,
          inputEnabled: session.inputEnabled,
          screenEnabled: session.screenEnabled,
          sessionId: session.id
        });
        activeHelpers.set(session.id, helper);
        helper.onExit((exitCode) => {
          if (activeHelpers.get(session.id) !== helper) {
            return;
          }

          activeHelpers.delete(session.id);
          void client.updateRemoteControlSession(session.id, {
            status: exitCode === 0 ? "ended" : "failed",
            ...(exitCode === 0
              ? {}
              : { errorMessage: `Remote helper exited with code ${exitCode}` })
          });
        });

        await client.updateRemoteControlSession(session.id, { status: "connecting" });
      }
    },

    stopAll() {
      for (const sessionId of activeHelpers.keys()) {
        stopHelper(activeHelpers, sessionId);
      }
    }
  };
}

function stopHelper(activeHelpers: Map<string, RemoteControlHelperProcess>, sessionId: string) {
  const helper = activeHelpers.get(sessionId);

  if (!helper) {
    return;
  }

  activeHelpers.delete(sessionId);
  helper.kill();
}

function defaultSpawnHelper(input: RemoteControlHelperInput): RemoteControlHelperProcess {
  const child = spawn(
    input.helperPath,
    ["--session-id", input.sessionId, "--api-url", input.apiUrl],
    {
      env: {
        ...process.env,
        ABITAT_HOST_TOKEN: input.hostToken ?? "",
        ABITAT_REMOTE_CONTROL_INPUT: input.inputEnabled ? "1" : "0",
        ABITAT_REMOTE_CONTROL_CLIENT_MACHINE_ID: input.clientMachineId,
        ABITAT_REMOTE_CONTROL_SCREEN: input.screenEnabled ? "1" : "0",
        ABITAT_REMOTE_CONTROL_SESSION_ID: input.sessionId
      },
      stdio: "ignore"
    }
  );

  return {
    kill() {
      child.kill();
    },
    onExit(handler) {
      child.once("exit", (code) => handler(code));
    }
  };
}
