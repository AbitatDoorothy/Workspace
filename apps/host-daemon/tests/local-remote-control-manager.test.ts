import { describe, expect, it, vi } from "vitest";

import {
  createLocalRemoteControlManager,
  type LocalRemoteControlDriver
} from "../src/local-control/remote-control/session-manager";

describe("local remote-control manager", () => {
  it("starts a session and stores only the latest frame", async () => {
    const driver = createFakeDriver();
    const manager = createLocalRemoteControlManager({
      driver,
      frameIntervalMs: 10,
      idGenerator: (prefix) => `${prefix}_demo`,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });

    const session = await manager.startSession({
      clientMachineId: "phone_demo",
      hostMachineId: "mac_demo",
      inputEnabled: true,
      screenEnabled: true
    });

    expect(session).toMatchObject({
      id: "remote_demo",
      status: "connecting",
      clientMachineId: "phone_demo",
      hostMachineId: "mac_demo"
    });

    await manager.captureNextFrameForTest(session.id);
    driver.nextFrameSequence = 2;
    await manager.captureNextFrameForTest(session.id);

    expect(manager.getLatestFrame(session.id, "phone_demo", 1)).toMatchObject({
      frame: {
        sequence: 2,
        dataBase64: "ZnJhbWUtMg=="
      },
      session: {
        status: "active"
      }
    });
    expect(manager.getLatestFrame(session.id, "phone_demo", 2).frame).toBeNull();
  });

  it("rejects access from another paired phone", async () => {
    const manager = createLocalRemoteControlManager({
      driver: createFakeDriver(),
      idGenerator: (prefix) => `${prefix}_demo`,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });
    const session = await manager.startSession({
      clientMachineId: "phone_demo",
      hostMachineId: "mac_demo",
      inputEnabled: true,
      screenEnabled: true
    });

    expect(() => manager.getSession(session.id, "phone_other")).toThrow(
      "Remote-control session not found"
    );
  });

  it("reports the focused Mac text target for the active paired phone", async () => {
    const driver = createFakeDriver();
    driver.currentTextInputTarget = {
      appName: "Notes",
      isTextInput: true,
      role: "AXTextArea",
      roleDescription: "text area"
    };
    const manager = createLocalRemoteControlManager({
      driver,
      idGenerator: (prefix) => `${prefix}_demo`,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });
    const session = await manager.startSession({
      clientMachineId: "phone_demo",
      hostMachineId: "mac_demo",
      inputEnabled: true,
      screenEnabled: true
    });

    await expect(manager.getTextInputTarget(session.id, "phone_demo")).resolves.toEqual({
      appName: "Notes",
      isTextInput: true,
      role: "AXTextArea",
      roleDescription: "text area"
    });
    await expect(manager.getTextInputTarget(session.id, "phone_other")).rejects.toThrow(
      "Remote-control session not found"
    );
  });

  it("dispatches validated input to the driver and marks accessibility needed on failure", async () => {
    const driver = createFakeDriver();
    driver.inputError = Object.assign(new Error("Accessibility permission required"), {
      permission: "accessibility"
    });
    const manager = createLocalRemoteControlManager({
      driver,
      idGenerator: (prefix) => `${prefix}_demo`,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });
    const session = await manager.startSession({
      clientMachineId: "phone_demo",
      hostMachineId: "mac_demo",
      inputEnabled: true,
      screenEnabled: true
    });

    await expect(
      manager.applyInput(session.id, "phone_demo", {
        phase: "up",
        type: "pointer",
        x: 0.5,
        y: 0.5
      })
    ).rejects.toThrow("Accessibility permission required");

    expect(manager.getSession(session.id, "phone_demo")).toMatchObject({
      permissionState: {
        accessibility: "needed"
      }
    });
  });

  it("tracks Mac cursor position from session start and input acknowledgements", async () => {
    const driver = createFakeDriver();
    driver.currentCursorPosition = { x: 0.25, y: 0.4 };
    driver.nextInputCursorPosition = { x: 0.5, y: 0.6 };
    const manager = createLocalRemoteControlManager({
      driver,
      idGenerator: (prefix) => `${prefix}_demo`,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });

    const session = await manager.startSession({
      clientMachineId: "phone_demo",
      hostMachineId: "mac_demo",
      inputEnabled: true,
      screenEnabled: true
    });

    expect(session.cursorPosition).toEqual({ x: 0.25, y: 0.4 });
    await expect(
      manager.applyInput(session.id, "phone_demo", {
        dx: 0.25,
        dy: 0.2,
        phase: "move",
        type: "pointer",
        x: 0,
        y: 0
      })
    ).resolves.toMatchObject({
      cursorPosition: {
        x: 0.5,
        y: 0.6
      }
    });
  });

  it("ends a session and stops the frame timer", async () => {
    vi.useFakeTimers();
    try {
      const driver = createFakeDriver();
      const manager = createLocalRemoteControlManager({
        driver,
        frameIntervalMs: 50,
        idGenerator: (prefix) => `${prefix}_demo`,
        now: () => new Date("2026-05-18T09:00:00.000Z")
      });
      const session = await manager.startSession({
        clientMachineId: "phone_demo",
        hostMachineId: "mac_demo",
        inputEnabled: true,
        screenEnabled: true
      });
      await Promise.resolve();
      const captureCountBeforeEnd = driver.captureCount;

      await manager.endSession(session.id, "phone_demo");
      await vi.advanceTimersByTimeAsync(150);

      expect(driver.captureCount).toBe(captureCountBeforeEnd);
      expect(manager.getSession(session.id, "phone_demo")).toMatchObject({
        status: "ended"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a responsive default frame cadence for remote control", async () => {
    vi.useFakeTimers();
    try {
      const driver = createFakeDriver();
      const manager = createLocalRemoteControlManager({
        driver,
        idGenerator: (prefix) => `${prefix}_demo`,
        now: () => new Date("2026-05-18T09:00:00.000Z")
      });

      await manager.startSession({
        clientMachineId: "phone_demo",
        hostMachineId: "mac_demo",
        inputEnabled: true,
        screenEnabled: true
      });
      await Promise.resolve();

      expect(driver.captureCount).toBe(1);
      await vi.advanceTimersByTimeAsync(250);

      expect(driver.captureCount).toBeGreaterThanOrEqual(3);
      await manager.stopAll();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not overlap frame captures when the Mac is still producing a frame", async () => {
    vi.useFakeTimers();
    try {
      const driver = createFakeDriver();
      driver.holdCaptures = true;
      const manager = createLocalRemoteControlManager({
        driver,
        frameIntervalMs: 25,
        idGenerator: (prefix) => `${prefix}_demo`,
        now: () => new Date("2026-05-18T09:00:00.000Z")
      });

      await manager.startSession({
        clientMachineId: "phone_demo",
        hostMachineId: "mac_demo",
        inputEnabled: true,
        screenEnabled: true
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(100);

      expect(driver.captureCount).toBe(1);

      driver.releaseCaptures();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(25);

      expect(driver.captureCount).toBe(2);
      await manager.stopAll();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a frame that finishes after the session has ended", async () => {
    const driver = createFakeDriver();
    driver.holdCaptures = true;
    const manager = createLocalRemoteControlManager({
      driver,
      idGenerator: (prefix) => `${prefix}_demo`,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });

    const session = await manager.startSession({
      clientMachineId: "phone_demo",
      hostMachineId: "mac_demo",
      inputEnabled: true,
      screenEnabled: true
    });
    await Promise.resolve();
    const endPromise = manager.endSession(session.id, "phone_demo");

    driver.releaseCaptures();
    await endPromise;
    await Promise.resolve();

    expect(manager.getLatestFrame(session.id, "phone_demo", -1)).toMatchObject({
      frame: null,
      session: {
        status: "ended"
      }
    });
  });

  it("clears the latest frame and rejects input after a session ends", async () => {
    const driver = createFakeDriver();
    const manager = createLocalRemoteControlManager({
      driver,
      idGenerator: (prefix) => `${prefix}_demo`,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });
    const session = await manager.startSession({
      clientMachineId: "phone_demo",
      hostMachineId: "mac_demo",
      inputEnabled: true,
      screenEnabled: true
    });

    await manager.captureNextFrameForTest(session.id);
    await manager.endSession(session.id, "phone_demo");

    expect(manager.getLatestFrame(session.id, "phone_demo", -1)).toMatchObject({
      frame: null,
      session: {
        status: "ended"
      }
    });
    await expect(
      manager.applyInput(session.id, "phone_demo", {
        type: "text",
        value: "should not send"
      })
    ).rejects.toThrow("Remote-control session is not active");
  });
});

function createFakeDriver() {
  const driver: LocalRemoteControlDriver & {
    captureCount: number;
    currentCursorPosition: { x: number; y: number } | null;
    currentTextInputTarget: {
      appName: string;
      isTextInput: boolean;
      role: string;
      roleDescription?: string;
      subrole?: string;
    } | null;
    inputError: Error | null;
    holdCaptures: boolean;
    nextInputCursorPosition: { x: number; y: number } | null;
    nextFrameSequence: number;
    releaseCaptures: () => void;
    releaseHeldCapture: (() => void) | null;
  } = {
    captureCount: 0,
    currentCursorPosition: null,
    currentTextInputTarget: null,
    holdCaptures: false,
    inputError: null,
    nextInputCursorPosition: null,
    nextFrameSequence: 1,
    releaseCaptures() {
      driver.releaseHeldCapture?.();
      driver.releaseHeldCapture = null;
    },
    releaseHeldCapture: null,
    async captureFrame() {
      driver.captureCount += 1;
      if (driver.holdCaptures) {
        await new Promise<void>((resolve) => {
          driver.releaseHeldCapture = resolve;
        });
        driver.holdCaptures = false;
      }
      return {
        capturedAt: "2026-05-18T09:00:01.000Z",
        dataBase64: Buffer.from(`frame-${driver.nextFrameSequence}`).toString("base64"),
        height: 720,
        mimeType: "image/jpeg",
        sequence: driver.nextFrameSequence,
        width: 1170
      };
    },
    async applyInput() {
      if (driver.inputError) {
        throw driver.inputError;
      }
      if (driver.nextInputCursorPosition) {
        driver.currentCursorPosition = driver.nextInputCursorPosition;
        return { cursorPosition: driver.nextInputCursorPosition };
      }
      return undefined;
    },
    async closeSession() {},
    async getCursorPosition() {
      return driver.currentCursorPosition;
    },
    async getTextInputTarget() {
      return driver.currentTextInputTarget;
    }
  };

  return driver;
}
