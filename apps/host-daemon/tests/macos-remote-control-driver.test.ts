import { describe, expect, it } from "vitest";

import { createMacOsRemoteControlDriver } from "../src/local-control/remote-control/macos-driver";
import type { LocalRemoteControlSession } from "../src/local-control/remote-control/types";

describe("macOS remote-control driver", () => {
  it("captures and compresses a JPEG frame without exposing screen data in errors", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        if (command === "/usr/bin/sips" && args.includes("-g")) {
          return { stderr: "", stdout: "  pixelWidth: 1920\n  pixelHeight: 1200\n" };
        }
        return { stderr: "", stdout: "" };
      },
      readFile: async () => Buffer.from("jpeg-bytes"),
      unlink: async () => undefined,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });

    await expect(driver.captureFrame(session())).resolves.toMatchObject({
      dataBase64: Buffer.from("jpeg-bytes").toString("base64"),
      height: 800,
      mimeType: "image/jpeg",
      width: 1280
    });
    expect(calls.map((call) => call.command)).toEqual([
      "/usr/sbin/screencapture",
      "/usr/bin/sips",
      "/usr/bin/sips"
    ]);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(["-C"]));
    expect(calls[2]?.args).toEqual(expect.arrayContaining(["-Z", "1280"]));
    expect(calls[2]?.args).toEqual(expect.arrayContaining(["formatOptions", "22"]));
  });

  it("reuses cached screen dimensions so steady-state captures avoid an extra sips pass", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        if (command === "/usr/bin/sips" && args.includes("-g")) {
          return { stderr: "", stdout: "  pixelWidth: 1920\n  pixelHeight: 1200\n" };
        }
        return { stderr: "", stdout: "" };
      },
      readFile: async () => Buffer.from("jpeg-bytes"),
      unlink: async () => undefined,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });

    await driver.captureFrame(session());
    await expect(driver.captureFrame(session())).resolves.toMatchObject({
      height: 800,
      width: 1280
    });

    const dimensionProbeCount = calls.filter(
      (call) => call.command === "/usr/bin/sips" && call.args.includes("-g")
    ).length;
    expect(dimensionProbeCount).toBe(1);
  });

  it("marks screen recording permission as needed when screencapture is blocked", async () => {
    const driver = createMacOsRemoteControlDriver({
      execFile: async () => {
        throw Object.assign(new Error("screencapture failed"), {
          stderr: "Screen recording permission denied"
        });
      }
    });

    await expect(driver.captureFrame(session())).rejects.toMatchObject({
      message: "Screen Recording permission is required for remote control",
      permission: "screenRecording"
    });
  });

  it("uses System Events for text and click input", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return { stderr: "", stdout: "" };
      }
    });

    await driver.applyInput(session(), { type: "text", value: "hello" });
    await driver.applyInput(session(), { type: "pointer", phase: "up", x: 0.5, y: 0.25 });

    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: ["-e", expect.stringContaining('keystroke "hello"')]
      },
      {
        command: "/usr/bin/osascript",
        args: ["-e", expect.stringContaining("click at {720, 225}")]
      }
    ]);
  });

  it("reports the focused text target without reading the focused field value", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return { stderr: "", stdout: "Notes\nAXTextArea\n\ntext area\n" };
      }
    });

    await expect(driver.getTextInputTarget?.()).resolves.toEqual({
      appName: "Notes",
      isTextInput: true,
      role: "AXTextArea",
      roleDescription: "text area"
    });
    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: ["-e", expect.stringContaining("AXFocusedUIElement")]
      }
    ]);
    expect(calls[0]?.args.join("\n")).not.toContain("AXValue");
  });

  it("opens Mission Control for the all desktops phone control", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return { stderr: "", stdout: "" };
      }
    });

    await driver.applyInput(session(), {
      key: "mission-control",
      modifiers: [],
      type: "key"
    });

    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: ["-e", expect.stringContaining("key code 126 using {control down}")]
      }
    ]);
  });

  it("moves between Mission Control desktops without selecting one", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return { stderr: "", stdout: "" };
      }
    });

    await driver.applyInput(session(), {
      key: "mission-control-left",
      modifiers: [],
      type: "key"
    });
    await driver.applyInput(session(), {
      key: "mission-control-right",
      modifiers: [],
      type: "key"
    });

    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: ["-e", expect.stringContaining("key code 123 using {control down}")]
      },
      {
        command: "/usr/bin/osascript",
        args: ["-e", expect.stringContaining("key code 124 using {control down}")]
      }
    ]);
  });

  it("toggles the Dock for the phone Dock control", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return { stderr: "", stdout: "" };
      }
    });

    await driver.applyInput(session(), {
      key: "dock",
      modifiers: [],
      type: "key"
    });

    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: ["-e", expect.stringContaining("key code 2 using {command down, option down}")]
      }
    ]);
  });

  it("moves the cursor to absolute screen coordinates and reports that position", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return { stderr: "", stdout: "" };
      }
    });

    await expect(
      driver.applyInput(session(), { type: "pointer", phase: "move", x: 0.25, y: 0.5 })
    ).resolves.toEqual({
      cursorPosition: {
        x: 0.25,
        y: 0.5
      }
    });

    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: [
          "-l",
          "JavaScript",
          "-e",
          expect.stringContaining("CGWarpMouseCursorPosition")
        ]
      }
    ]);
    expect(calls[0]?.args[3]).toContain("targetPointFromNormalized(0.25, 0.5)");
    expect(calls[0]?.args[3]).not.toContain("const targetX = 360");
    expect(calls[0]?.args[3]).not.toContain("const targetY = 450");
  });

  it("moves the cursor relative to its current Mac position for trackpad deltas", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        if (command === "/usr/bin/osascript") {
          return { stderr: "", stdout: '{"x":864,"y":405}\n' };
        }
        return { stderr: "", stdout: "" };
      }
    });

    await expect(
      driver.applyInput(session(), {
        dx: 0.1,
        dy: -0.05,
        phase: "move",
        type: "pointer",
        x: 0,
        y: 0
      })
    ).resolves.toEqual({
      cursorPosition: {
        x: 0.6,
        y: 0.45
      }
    });

    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: [
          "-l",
          "JavaScript",
          "-e",
          expect.stringContaining("CGEventGetLocation")
        ]
      }
    ]);
    expect(calls[0]?.args[3]).toContain("point.x + bounds.width * 0.1");
    expect(calls[0]?.args[3]).toContain("point.y + bounds.height * -0.05");
  });

  it("reports the current cursor position without a pointer input event", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return {
          stderr: "",
          stdout: '{"x":720,"y":225,"bounds":{"x":0,"y":0,"width":1440,"height":900}}\n'
        };
      }
    });

    await expect(driver.getCursorPosition?.()).resolves.toEqual({
      x: 0.5,
      y: 0.25
    });

    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: [
          "-l",
          "JavaScript",
          "-e",
          expect.stringContaining("CGEventGetLocation")
        ]
      }
    ]);
  });

  it("clicks at the current Mac cursor position for trackpad taps", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return { stderr: "", stdout: '{"x":360,"y":540}\n' };
      }
    });

    await expect(
      driver.applyInput(session(), {
        dx: 0,
        dy: 0,
        phase: "up",
        type: "pointer",
        x: 0,
        y: 0
      })
    ).resolves.toEqual({
      cursorPosition: {
        x: 0.25,
        y: 0.6
      }
    });

    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: [
          "-l",
          "JavaScript",
          "-e",
          expect.stringContaining("CGEventCreateMouseEvent")
        ]
      }
    ]);
    expect(calls[0]?.args[3]).toContain("CGEventGetLocation");
    expect(calls[0]?.args[3]).toContain("kCGEventLeftMouseDown");
    expect(calls[0]?.args[3]).toContain("kCGEventLeftMouseUp");
  });

  it("right clicks at the current Mac cursor position for trackpad right-click input", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return { stderr: "", stdout: '{"x":360,"y":540}\n' };
      }
    });

    await expect(
      driver.applyInput(session(), {
        buttons: 2,
        dx: 0,
        dy: 0,
        phase: "up",
        type: "pointer",
        x: 0,
        y: 0
      })
    ).resolves.toEqual({
      cursorPosition: {
        x: 0.25,
        y: 0.6
      }
    });

    expect(calls[0]?.args[3]).toContain("kCGMouseButtonRight");
    expect(calls[0]?.args[3]).toContain("kCGEventRightMouseDown");
    expect(calls[0]?.args[3]).toContain("kCGEventRightMouseUp");
  });

  it("keeps absolute pointer taps compatible with direct screen coordinates", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        return { stderr: "", stdout: "" };
      }
    });

    await expect(
      driver.applyInput(session(), {
        phase: "up",
        type: "pointer",
        x: 0.5,
        y: 0.25
      })
    ).resolves.toEqual({
      cursorPosition: {
        x: 0.5,
        y: 0.25
      }
    });

    expect(calls).toEqual([
      {
        command: "/usr/bin/osascript",
        args: ["-e", expect.stringContaining("click at {720, 225}")]
      }
    ]);
  });

  it("marks accessibility permission as needed when System Events is blocked", async () => {
    const driver = createMacOsRemoteControlDriver({
      execFile: async () => {
        throw Object.assign(new Error("osascript failed"), {
          stderr: "System Events is not allowed assistive access"
        });
      }
    });

    await expect(driver.applyInput(session(), { type: "text", value: "hello" })).rejects.toMatchObject(
      {
        message: "Accessibility permission is required for remote control input",
        permission: "accessibility"
      }
    );
  });
});

function session(): LocalRemoteControlSession {
  return {
    clientMachineId: "phone_demo",
    createdAt: "2026-05-18T09:00:00.000Z",
    hostMachineId: "mac_demo",
    id: "remote_demo",
    inputEnabled: true,
    permissionState: {
      accessibility: "unknown",
      screenRecording: "unknown"
    },
    screenEnabled: true,
    status: "active",
    updatedAt: "2026-05-18T09:00:00.000Z"
  };
}
