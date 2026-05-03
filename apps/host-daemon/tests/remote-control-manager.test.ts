import { describe, expect, it } from "vitest";

import {
  createRemoteControlManager,
  type RemoteControlClient,
  type RemoteControlHelperProcess
} from "../src/remote-control/manager";

describe("remote control manager", () => {
  it("starts a helper for requested sessions and marks them connecting", async () => {
    const client = createClient([
      {
        id: "remote_demo",
        status: "requested",
        hostMachineId: "machine_demo",
        clientMachineId: "machine_phone",
        screenEnabled: true,
        inputEnabled: true
      }
    ]);
    const helpers: FakeHelperProcess[] = [];
    const manager = createRemoteControlManager(client, {
      apiUrl: "https://workspace.example",
      helperPath: "/Applications/AbitatRemoteHelper.app/Contents/MacOS/AbitatRemoteHelper",
      hostToken: "host_secret",
      spawnHelper: (input) => {
        const helper = new FakeHelperProcess();
        helpers.push(helper);
        expect(input).toMatchObject({
          sessionId: "remote_demo",
          helperPath: "/Applications/AbitatRemoteHelper.app/Contents/MacOS/AbitatRemoteHelper"
        });
        return helper;
      }
    });

    await manager.tick("machine_demo");

    expect(helpers).toHaveLength(1);
    expect(client.updates).toEqual([{ sessionId: "remote_demo", status: "connecting" }]);
  });

  it("fails requested sessions when remote control has no helper path", async () => {
    const client = createClient([
      {
        id: "remote_demo",
        status: "requested",
        hostMachineId: "machine_demo",
        clientMachineId: "machine_phone",
        screenEnabled: true,
        inputEnabled: true
      }
    ]);
    const manager = createRemoteControlManager(client, {
      apiUrl: "https://workspace.example",
      helperPath: "",
      hostToken: "host_secret"
    });

    await manager.tick("machine_demo");

    expect(client.updates).toEqual([
      {
        sessionId: "remote_demo",
        status: "failed",
        errorMessage: "Remote-control helper is not configured"
      }
    ]);
  });

  it("stops the helper when a session ends", async () => {
    const client = createClient([
      {
        id: "remote_demo",
        status: "requested",
        hostMachineId: "machine_demo",
        clientMachineId: "machine_phone",
        screenEnabled: true,
        inputEnabled: true
      }
    ]);
    const helper = new FakeHelperProcess();
    const manager = createRemoteControlManager(client, {
      apiUrl: "https://workspace.example",
      helperPath: "/tmp/helper",
      hostToken: "host_secret",
      spawnHelper: () => helper
    });

    await manager.tick("machine_demo");
    client.sessions[0] = { ...client.sessions[0], status: "ended" };
    await manager.tick("machine_demo");

    expect(helper.killed).toBe(true);
  });
});

class FakeHelperProcess implements RemoteControlHelperProcess {
  killed = false;
  private exitHandler: ((exitCode: number | null) => void) | null = null;

  kill() {
    this.killed = true;
  }

  onExit(handler: (exitCode: number | null) => void) {
    this.exitHandler = handler;
  }

  exit(exitCode: number | null) {
    this.exitHandler?.(exitCode);
  }
}

function createClient(
  sessions: RemoteControlClient["pollRemoteControlSessions"] extends (
    machineId: string
  ) => Promise<{ sessions: infer TSessions }>
    ? TSessions
    : never
) {
  const client: RemoteControlClient & {
    sessions: typeof sessions;
    updates: Array<{ sessionId: string; status: string; errorMessage?: string }>;
  } = {
    sessions,
    updates: [],
    async pollRemoteControlSessions() {
      return { sessions };
    },
    async updateRemoteControlSession(sessionId, input) {
      client.updates.push({ sessionId, ...input });
      return {
        session: {
          id: sessionId,
          status: input.status,
          hostMachineId: "machine_demo",
          clientMachineId: "machine_phone",
          screenEnabled: true,
          inputEnabled: true
        }
      };
    }
  };

  return client;
}
