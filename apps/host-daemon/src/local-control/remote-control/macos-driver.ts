import { execFile as execFileCallback } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  RemoteControlCursorPosition,
  RemoteControlTextTarget,
  RemoteInputEvent
} from "@abitat_reece/shared";

import type { LocalRemoteControlDriver } from "./types.js";

type ExecFile = (
  command: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

type ReadFrameFile = (path: string) => Promise<Buffer>;
type UnlinkFrameFile = (path: string) => Promise<void>;

interface DriverOptions {
  execFile?: ExecFile;
  now?: () => Date;
  readFile?: ReadFrameFile;
  unlink?: UnlinkFrameFile;
}

const runExecFile = promisify(execFileCallback) as ExecFile;
const CAPTURE_WIDTH = 1280;
const FRAME_JPEG_QUALITY = 22;
const SCREEN_DIMENSION_PROBE_INTERVAL_FRAMES = 30;
const DEFAULT_DISPLAY_WIDTH = 1440;
const DEFAULT_DISPLAY_HEIGHT = 900;

export function createMacOsRemoteControlDriver(
  options: DriverOptions = {}
): LocalRemoteControlDriver {
  const execFile = options.execFile ?? runExecFile;
  const readFrameFile = options.readFile ?? (readFile as ReadFrameFile);
  const unlinkFrameFile = options.unlink ?? unlink;
  const now = options.now ?? (() => new Date());
  let sequence = 0;
  let screenSize = {
    height: DEFAULT_DISPLAY_HEIGHT,
    width: DEFAULT_DISPLAY_WIDTH
  };

  return {
    async captureFrame(session) {
      const rawPath = capturePath(session.id, "raw.jpg");
      const framePath = capturePath(session.id, "frame.jpg");

      try {
        await execFile("/usr/sbin/screencapture", ["-x", "-C", "-t", "jpg", rawPath]);
        if (shouldProbeScreenDimensions(sequence)) {
          const rawDimensions = await execFile("/usr/bin/sips", [
            "-g",
            "pixelWidth",
            "-g",
            "pixelHeight",
            rawPath
          ]);
          screenSize = {
            height: numberFromSips(rawDimensions.stdout, "pixelHeight") ?? screenSize.height,
            width: numberFromSips(rawDimensions.stdout, "pixelWidth") ?? screenSize.width
          };
        }
        await execFile("/usr/bin/sips", [
          "-Z",
          String(CAPTURE_WIDTH),
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          String(FRAME_JPEG_QUALITY),
          rawPath,
          "--out",
          framePath
        ]);
        const image = await readFrameFile(framePath);
        const frameSize = scaledFrameSize(screenSize);
        sequence += 1;

        return {
          capturedAt: now().toISOString(),
          dataBase64: image.toString("base64"),
          height: frameSize.height,
          mimeType: "image/jpeg" as const,
          sequence,
          width: frameSize.width
        };
      } catch (error) {
        throw normalizeCaptureError(error);
      } finally {
        await Promise.all([
          unlinkFrameFile(rawPath).catch(() => undefined),
          unlinkFrameFile(framePath).catch(() => undefined)
        ]);
      }
    },
    async applyInput(_session, event) {
      try {
        const result = await execFile(
          "/usr/bin/osascript",
          osascriptArgsForInput(event, screenSize)
        );
        return (
          cursorPositionFromStdout(result.stdout, screenSize) ??
          cursorPositionForDeterministicInput(event)
        );
      } catch (error) {
        throw normalizeInputError(error);
      }
    },
    async closeSession() {},
    async getCursorPosition() {
      const result = await execFile("/usr/bin/osascript", [
        "-l",
        "JavaScript",
        "-e",
        javaScriptForCurrentCursorPosition()
      ]);
      return cursorPositionFromStdout(result.stdout, screenSize)?.cursorPosition ?? null;
    },
    async getTextInputTarget() {
      try {
        const result = await execFile("/usr/bin/osascript", [
          "-e",
          appleScriptForFocusedTextTarget()
        ]);
        return textInputTargetFromStdout(result.stdout);
      } catch (error) {
        throw normalizeInputError(error);
      }
    }
  };
}

function osascriptArgsForInput(
  event: RemoteInputEvent,
  screenSize: { height: number; width: number }
) {
  if (event.type === "pointer" && event.phase === "move") {
    return [
      "-l",
      "JavaScript",
      "-e",
      hasPointerDelta(event)
        ? javaScriptForRelativePointerMove(event)
        : javaScriptForPointerMove(event)
    ];
  }

  if (event.type === "pointer" && event.phase === "up" && hasPointerDelta(event)) {
    return ["-l", "JavaScript", "-e", javaScriptForCurrentPointerClick(event)];
  }

  return ["-e", appleScriptForInput(event, screenSize)];
}

function appleScriptForInput(
  event: RemoteInputEvent,
  screenSize: { height: number; width: number }
) {
  if (event.type === "text") {
    return `tell application "System Events" to keystroke ${JSON.stringify(event.value)}`;
  }

  if (event.type === "key") {
    if (event.key === "dock") {
      return "tell application \"System Events\" to key code 2 using {command down, option down}";
    }
    if (event.key === "mission-control") {
      return "tell application \"System Events\" to key code 126 using {control down}";
    }
    if (event.key === "mission-control-left") {
      return "tell application \"System Events\" to key code 123 using {control down}";
    }
    if (event.key === "mission-control-right") {
      return "tell application \"System Events\" to key code 124 using {control down}";
    }

    const modifierPrefix = event.modifiers.length
      ? ` using {${event.modifiers.map(appleScriptModifier).join(", ")}}`
      : "";
    return `tell application "System Events" to keystroke ${JSON.stringify(event.key)}${modifierPrefix}`;
  }

  if (event.type === "pointer" && event.phase === "up") {
    const x = Math.round(event.x * screenSize.width);
    const y = Math.round(event.y * screenSize.height);
    return `tell application "System Events" to click at {${x}, ${y}}`;
  }

  if (event.type === "pointer" && event.phase === "scroll") {
    const direction = (event.dy ?? 0) > 0 ? "down" : "up";
    return `tell application "System Events" to scroll ${direction}`;
  }

  return `tell application "System Events" to delay 0`;
}

function appleScriptForFocusedTextTarget() {
  return [
    'tell application "System Events"',
    "  set frontApp to first application process whose frontmost is true",
    "  set appName to name of frontApp",
    "  try",
    '    set focusedElement to value of attribute "AXFocusedUIElement" of frontApp',
    "  on error errorMessage",
    '    if errorMessage contains "not allowed" or errorMessage contains "not authorized" or errorMessage contains "assistive" or errorMessage contains "permission" then error errorMessage',
    '    return appName & linefeed & "" & linefeed & "" & linefeed & ""',
    "  end try",
    '  set roleValue to ""',
    "  try",
    '    set roleValue to value of attribute "AXRole" of focusedElement as text',
    "  end try",
    '  set subroleValue to ""',
    "  try",
    '    set subroleValue to value of attribute "AXSubrole" of focusedElement as text',
    "  end try",
    '  set roleDescriptionValue to ""',
    "  try",
    '    set roleDescriptionValue to value of attribute "AXRoleDescription" of focusedElement as text',
    "  end try",
    "  return appName & linefeed & roleValue & linefeed & subroleValue & linefeed & roleDescriptionValue",
    "end tell"
  ].join("\n");
}

function javaScriptForPointerMove(event: Extract<RemoteInputEvent, { type: "pointer" }>) {
  return [
    'ObjC.import("CoreGraphics");',
    'ObjC.import("AppKit");',
    javaScriptCursorSnapshotHelpers(),
    `const targetPoint = targetPointFromNormalized(${clamp01(event.x)}, ${clamp01(event.y)});`,
    "$.CGWarpMouseCursorPosition($.CGPointMake(targetPoint.x, targetPoint.y));",
    "$.CGAssociateMouseAndMouseCursorPosition(true);",
    "cursorPositionSnapshot();"
  ].join("\n");
}

function javaScriptForRelativePointerMove(
  event: Extract<RemoteInputEvent, { type: "pointer" }>
) {
  return [
    'ObjC.import("CoreGraphics");',
    'ObjC.import("AppKit");',
    javaScriptCursorSnapshotHelpers(),
    "const bounds = desktopBounds();",
    "const currentEvent = $.CGEventCreate(null);",
    "const point = $.CGEventGetLocation(currentEvent);",
    `const targetX = Math.max(bounds.x, Math.min(bounds.x + bounds.width, point.x + bounds.width * ${event.dx ?? 0}));`,
    `const targetY = Math.max(bounds.y, Math.min(bounds.y + bounds.height, point.y + bounds.height * ${event.dy ?? 0}));`,
    "$.CGWarpMouseCursorPosition($.CGPointMake(targetX, targetY));",
    "$.CGAssociateMouseAndMouseCursorPosition(true);",
    "cursorPositionSnapshot();"
  ].join("\n");
}

function javaScriptForCurrentPointerClick(event: Extract<RemoteInputEvent, { type: "pointer" }>) {
  const isRightClick = event.buttons === 2;
  const button = isRightClick ? "$.kCGMouseButtonRight" : "$.kCGMouseButtonLeft";
  const downEvent = isRightClick ? "$.kCGEventRightMouseDown" : "$.kCGEventLeftMouseDown";
  const upEvent = isRightClick ? "$.kCGEventRightMouseUp" : "$.kCGEventLeftMouseUp";
  return [
    'ObjC.import("CoreGraphics");',
    'ObjC.import("AppKit");',
    javaScriptCursorSnapshotHelpers(),
    "const currentEvent = $.CGEventCreate(null);",
    "const point = $.CGEventGetLocation(currentEvent);",
    `const mouseDown = $.CGEventCreateMouseEvent(null, ${downEvent}, point, ${button});`,
    `const mouseUp = $.CGEventCreateMouseEvent(null, ${upEvent}, point, ${button});`,
    "$.CGEventPost($.kCGHIDEventTap, mouseDown);",
    "$.CGEventPost($.kCGHIDEventTap, mouseUp);",
    "cursorPositionSnapshot();"
  ].join("\n");
}

function javaScriptForCurrentCursorPosition() {
  return [
    'ObjC.import("AppKit");',
    javaScriptCursorSnapshotHelpers(),
    "cursorPositionSnapshot();"
  ].join("\n");
}

function javaScriptCursorSnapshotHelpers() {
  return [
    "function desktopBounds() {",
    "  const screens = $.NSScreen.screens;",
    "  const mainScreenHeight = $.NSScreen.mainScreen.frame.size.height;",
    "  let minX = Infinity;",
    "  let minY = Infinity;",
    "  let maxX = -Infinity;",
    "  let maxY = -Infinity;",
    "  for (let i = 0; i < screens.count; i += 1) {",
    "    const frame = screens.objectAtIndex(i).frame;",
    "    minX = Math.min(minX, frame.origin.x);",
    "    minY = Math.min(minY, frame.origin.y);",
    "    maxX = Math.max(maxX, frame.origin.x + frame.size.width);",
    "    maxY = Math.max(maxY, frame.origin.y + frame.size.height);",
    "  }",
    "  return {",
    "    x: minX,",
    "    y: mainScreenHeight - maxY,",
    "    width: maxX - minX,",
    "    height: maxY - minY",
    "  };",
    "}",
    "function targetPointFromNormalized(x, y) {",
    "  const bounds = desktopBounds();",
    "  return {",
    "    x: bounds.x + Math.max(0, Math.min(1, x)) * bounds.width,",
    "    y: bounds.y + Math.max(0, Math.min(1, y)) * bounds.height",
    "  };",
    "}",
    "function cursorPositionSnapshot() {",
    "  const currentEvent = $.CGEventCreate(null);",
    "  const point = $.CGEventGetLocation(currentEvent);",
    "  const bounds = desktopBounds();",
    "  return JSON.stringify({",
    "    x: point.x,",
    "    y: point.y,",
    "    bounds",
    "  });",
    "}"
  ].join("\n");
}

function hasPointerDelta(event: Extract<RemoteInputEvent, { type: "pointer" }>) {
  return typeof event.dx === "number" || typeof event.dy === "number";
}

function cursorPositionForDeterministicInput(
  event: RemoteInputEvent
): { cursorPosition?: RemoteControlCursorPosition | null } | undefined {
  if (
    event.type !== "pointer" ||
    (event.phase !== "move" && event.phase !== "up") ||
    hasPointerDelta(event)
  ) {
    return undefined;
  }

  return {
    cursorPosition: {
      x: clamp01(event.x),
      y: clamp01(event.y)
    }
  };
}

function cursorPositionFromStdout(
  stdout: string,
  screenSize: { height: number; width: number }
): { cursorPosition: RemoteControlCursorPosition } | undefined {
  const point = parsePoint(stdout);
  if (!point) {
    return undefined;
  }

  return { cursorPosition: normalizedCursorPosition(point, screenSize) };
}

function parsePoint(stdout: string) {
  try {
    const parsed = JSON.parse(stdout.trim()) as {
      bounds?: unknown;
      x?: unknown;
      y?: unknown;
    };
    return typeof parsed.x === "number" && typeof parsed.y === "number"
      ? {
          bounds: parseBounds(parsed.bounds),
          x: parsed.x,
          y: parsed.y
        }
      : null;
  } catch {
    return null;
  }
}

function parseBounds(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const bounds = value as { height?: unknown; width?: unknown; x?: unknown; y?: unknown };
  return typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number" &&
    bounds.width > 0 &&
    bounds.height > 0
    ? {
        height: bounds.height,
        width: bounds.width,
        x: bounds.x,
        y: bounds.y
      }
    : null;
}

function textInputTargetFromStdout(stdout: string): RemoteControlTextTarget | null {
  const [rawAppName = "", rawRole = "", rawSubrole = "", rawRoleDescription = ""] = stdout
    .replace(/\r/gu, "")
    .split("\n");
  const appName = rawAppName.trim();
  const role = rawRole.trim();
  const subrole = rawSubrole.trim();
  const roleDescription = rawRoleDescription.trim();

  if (!appName && !role) {
    return null;
  }

  return {
    appName: appName || "Unknown app",
    isTextInput: isTextInputTarget(role, subrole, roleDescription),
    role,
    ...(roleDescription ? { roleDescription } : {}),
    ...(subrole ? { subrole } : {})
  };
}

function isTextInputTarget(role: string, subrole: string, roleDescription: string) {
  if (["AXTextArea", "AXTextField", "AXSearchField", "AXComboBox"].includes(role)) {
    return true;
  }

  const searchableText = `${role} ${subrole} ${roleDescription}`;
  return /\b(text|search|editor|combo box)\b/iu.test(searchableText);
}

function normalizedCursorPosition(
  point: {
    bounds: { height: number; width: number; x: number; y: number } | null;
    x: number;
    y: number;
  },
  screenSize: { height: number; width: number }
): RemoteControlCursorPosition {
  if (point.bounds) {
    return {
      x: clamp01((point.x - point.bounds.x) / point.bounds.width),
      y: clamp01((point.y - point.bounds.y) / point.bounds.height)
    };
  }

  return {
    x: clamp01(point.x / Math.max(1, screenSize.width)),
    y: clamp01(point.y / Math.max(1, screenSize.height))
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function scaledFrameSize(screenSize: { height: number; width: number }) {
  const scale = Math.min(1, CAPTURE_WIDTH / Math.max(1, screenSize.width));
  return {
    height: Math.max(1, Math.round(screenSize.height * scale)),
    width: Math.max(1, Math.round(screenSize.width * scale))
  };
}

function appleScriptModifier(modifier: string) {
  if (modifier === "cmd") {
    return "command down";
  }
  if (modifier === "ctrl") {
    return "control down";
  }
  if (modifier === "alt") {
    return "option down";
  }
  return "shift down";
}

function capturePath(sessionId: string, name: string) {
  return join(tmpdir(), `abitat-${sessionId}-${name}`);
}

function numberFromSips(output: string, key: string) {
  const match = output.match(new RegExp(`${key}:\\s*(\\d+)`, "u"));
  return match ? Number(match[1]) : null;
}

function shouldProbeScreenDimensions(sequence: number) {
  return sequence % SCREEN_DIMENSION_PROBE_INTERVAL_FRAMES === 0;
}

function normalizeCaptureError(error: unknown) {
  const stderr = errorStderr(error);
  if (/screen recording|permission|not authorized|denied/iu.test(stderr)) {
    return Object.assign(new Error("Screen Recording permission is required for remote control"), {
      permission: "screenRecording"
    });
  }
  return new Error(error instanceof Error ? error.message : "Unable to capture Mac screen");
}

function normalizeInputError(error: unknown) {
  const stderr = errorStderr(error);
  if (/assistive access|accessibility|not allowed|not authorized|denied/iu.test(stderr)) {
    return Object.assign(
      new Error("Accessibility permission is required for remote control input"),
      {
        permission: "accessibility"
      }
    );
  }
  return new Error(error instanceof Error ? error.message : "Unable to send Mac input");
}

function errorStderr(error: unknown) {
  if (typeof error === "object" && error && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    return typeof stderr === "string" ? stderr : "";
  }
  return "";
}
