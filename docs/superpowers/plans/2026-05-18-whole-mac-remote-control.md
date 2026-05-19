# Whole Mac Remote Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-first iPhone remote-control mode that lets a paired phone view and control the whole paired Mac screen without changing existing project, thread, chat, archive, token, log, queue, steer, or notification flows.

**Architecture:** Build remote control as an isolated local-control feature under `/api/remote-control/*`. The host daemon owns session state, captures one latest compressed screen frame per session, validates input, and executes Mac input only after a paired phone starts a session. The iOS app receives frames by polling and sends explicit input requests; no hosted database path is used for the core feature.

**Tech Stack:** TypeScript, Node.js host daemon, macOS `screencapture`, `sips`, `osascript`/System Events, Expo React Native, existing Abitat local/relay pairing, existing Vitest and iOS validator scripts.

---

## Non-Negotiable Constraints

- Keep core control local-first and per-user paired.
- The phone may only control the Mac it is explicitly paired to.
- Do not build on the retired hosted `/api/mobile/*` or hosted `/api/remote-control/*` database paths.
- Do not change existing mobile projects, threads, messages, archive, token dashboard, logs, generated files, notifications, queue, or steer behavior.
- Do not capture the screen, request input permissions, or run macOS input commands until the user starts a remote-control session.
- Do not log screen images, typed text, bearer tokens, prompts, or raw input payloads.
- Keep frame memory bounded: only the latest frame per active session is retained.
- Keep the first version simple: low-FPS polling, click/tap, text entry, basic key commands, session lifecycle, and clear permission errors.

## Current Code Facts

- Existing iOS API methods are in `apps/ios/src/api/client.ts`.
- Existing iOS placeholder UI is in `apps/ios/src/screens/RemoteControlScreen.tsx`, but it is not routed from `apps/ios/src/App.tsx`.
- Existing local-control session/signal stubs are in `apps/host-daemon/src/local-control/server.ts`.
- Existing hosted remote-control service and Prisma models remain in `apps/web`, but `apps/web/middleware.ts` returns `410` for hosted mobile-control API paths.
- Existing shared schemas include `remoteControlSessionCreateRequestSchema`, `remoteControlSignalSchema`, and `remoteInputEventSchema` in `packages/shared/src/index.core.ts`.
- Existing host-daemon tests cover local-control server behavior in `apps/host-daemon/tests/local-control-server.test.ts`.

## File Structure

Create focused host-daemon files under `apps/host-daemon/src/local-control/remote-control/`:

- `types.ts`: Local remote-control domain types, frame shape, driver interface, route input types.
- `session-manager.ts`: Session lifecycle, active-session map, frame loop, latest-frame storage, TTL cleanup, permission-state updates, input dispatch.
- `macos-driver.ts`: macOS screen capture and input execution using built-in tools only.
- `routes.ts`: `/api/remote-control/*` local-control route handler, request validation, sanitized diagnostics.

Modify existing host/iOS files:

- `apps/host-daemon/src/local-control/server.ts`: Create/inject the remote manager and delegate remote-control paths to `routes.ts`.
- `apps/host-daemon/tests/local-control-server.test.ts`: Add server-route tests with a fake remote manager.
- `apps/host-daemon/tests/local-remote-control-manager.test.ts`: Add manager tests with a fake driver.
- `apps/host-daemon/tests/macos-remote-control-driver.test.ts`: Add macOS driver command-construction tests with fake `execFile`.
- `apps/ios/src/types.ts`: Add frame/status types used by the UI.
- `apps/ios/src/api/client.ts`: Add `getRemoteSession`, `getRemoteFrame`, and `sendRemoteInput`; keep existing signal methods for compatibility.
- `apps/ios/src/App.tsx`: Add an isolated `remoteControl` route and a dashboard-start request key that does not pass through project/thread routes.
- `apps/ios/src/screens/SettingsScreen.tsx`: Add a `START REMOTE CONTROL` button to the current dashboard page that already shows token usage, request log, and disconnect.
- `apps/ios/src/screens/RemoteControlScreen.tsx`: Replace the placeholder signaling UI with polling frame display and input controls.
- `apps/ios/scripts/validate-ios-app.mjs`: Validate remote-control route/API wiring.
- `packages/shared/src/index.core.ts`: Add request/response schemas for frame and input endpoints.
- `packages/shared/tests/schemas.test.ts`: Cover the new schemas.

Do not modify:

- `apps/web/prisma/*`
- `apps/web/server/remote-control/*`
- `apps/web/app/api/remote-control/*`
- `apps/web/middleware.ts`

Those hosted paths are retired for core mobile control and must remain out of the MVP.

---

## API Contract

### Start Session

`POST /api/remote-control/sessions`

Request:

```json
{
  "hostMachineId": "mac_abc",
  "screenEnabled": true,
  "inputEnabled": true
}
```

Response:

```json
{
  "session": {
    "id": "remote_abc",
    "status": "connecting",
    "hostMachineId": "mac_abc",
    "clientMachineId": "phone_abc",
    "screenEnabled": true,
    "inputEnabled": true,
    "permissionState": {
      "screenRecording": "unknown",
      "accessibility": "unknown"
    },
    "createdAt": "2026-05-18T09:00:00.000Z",
    "updatedAt": "2026-05-18T09:00:00.000Z"
  }
}
```

### Get Session

`GET /api/remote-control/sessions/:sessionId`

Response:

```json
{
  "session": {
    "id": "remote_abc",
    "status": "active",
    "hostMachineId": "mac_abc",
    "clientMachineId": "phone_abc",
    "screenEnabled": true,
    "inputEnabled": true,
    "permissionState": {
      "screenRecording": "granted",
      "accessibility": "unknown"
    },
    "createdAt": "2026-05-18T09:00:00.000Z",
    "updatedAt": "2026-05-18T09:00:01.000Z"
  }
}
```

### Get Latest Frame

`GET /api/remote-control/sessions/:sessionId/frame?afterSequence=12`

Response when a newer frame exists:

```json
{
  "frame": {
    "sequence": 13,
    "capturedAt": "2026-05-18T09:00:02.000Z",
    "width": 1170,
    "height": 731,
    "mimeType": "image/jpeg",
    "dataBase64": "/9j/4AAQSkZJRgABAQAAAQABAAD..."
  },
  "session": {
    "id": "remote_abc",
    "status": "active",
    "hostMachineId": "mac_abc",
    "clientMachineId": "phone_abc",
    "screenEnabled": true,
    "inputEnabled": true,
    "permissionState": {
      "screenRecording": "granted",
      "accessibility": "unknown"
    },
    "createdAt": "2026-05-18T09:00:00.000Z",
    "updatedAt": "2026-05-18T09:00:02.000Z"
  }
}
```

Response when no newer frame exists:

```json
{
  "frame": null,
  "session": {
    "id": "remote_abc",
    "status": "active",
    "hostMachineId": "mac_abc",
    "clientMachineId": "phone_abc",
    "screenEnabled": true,
    "inputEnabled": true,
    "permissionState": {
      "screenRecording": "granted",
      "accessibility": "unknown"
    },
    "createdAt": "2026-05-18T09:00:00.000Z",
    "updatedAt": "2026-05-18T09:00:02.000Z"
  }
}
```

### Send Input

`POST /api/remote-control/sessions/:sessionId/input`

Pointer tap request:

```json
{
  "event": {
    "type": "pointer",
    "phase": "up",
    "x": 0.5,
    "y": 0.5
  }
}
```

Text request:

```json
{
  "event": {
    "type": "text",
    "value": "hello"
  }
}
```

Response:

```json
{
  "ok": true,
  "session": {
    "id": "remote_abc",
    "status": "active",
    "hostMachineId": "mac_abc",
    "clientMachineId": "phone_abc",
    "screenEnabled": true,
    "inputEnabled": true,
    "permissionState": {
      "screenRecording": "granted",
      "accessibility": "granted"
    },
    "createdAt": "2026-05-18T09:00:00.000Z",
    "updatedAt": "2026-05-18T09:00:03.000Z"
  }
}
```

### End Session

`DELETE /api/remote-control/sessions/:sessionId`

Response:

```json
{
  "session": {
    "id": "remote_abc",
    "status": "ended",
    "hostMachineId": "mac_abc",
    "clientMachineId": "phone_abc",
    "screenEnabled": true,
    "inputEnabled": true,
    "permissionState": {
      "screenRecording": "granted",
      "accessibility": "granted"
    },
    "createdAt": "2026-05-18T09:00:00.000Z",
    "updatedAt": "2026-05-18T09:00:05.000Z"
  }
}
```

---

## Task 1: Shared Schemas For Local Frames And Input Requests

**Files:**
- Modify: `packages/shared/src/index.core.ts`
- Modify: `packages/shared/tests/schemas.test.ts`

- [ ] **Step 1: Add failing schema tests**

Add test coverage in `packages/shared/tests/schemas.test.ts` near the existing remote-control schema test:

```ts
// Add these names to the existing import from "../src/index":
// remoteControlFrameResponseSchema
// remoteControlInputRequestSchema

it("accepts local remote-control frame and input endpoint payloads", () => {
  expect(
    remoteControlSessionResponseSchema.parse({
      id: "remote_demo",
      status: "active",
      hostMachineId: "mac_demo",
      clientMachineId: "phone_demo",
      screenEnabled: true,
      inputEnabled: true,
      permissionState: {
        accessibility: "unknown",
        screenRecording: "granted"
      },
      createdAt: "2026-05-18T09:00:00.000Z",
      updatedAt: "2026-05-18T09:00:01.000Z"
    })
  ).toMatchObject({
    id: "remote_demo",
    permissionState: {
      screenRecording: "granted"
    }
  });

  expect(
    remoteControlFrameResponseSchema.parse({
      frame: {
        capturedAt: "2026-05-18T09:00:02.000Z",
        dataBase64: "aGVsbG8=",
        height: 720,
        mimeType: "image/jpeg",
        sequence: 2,
        width: 1170
      },
      session: {
        id: "remote_demo",
        status: "active",
        hostMachineId: "mac_demo",
        clientMachineId: "phone_demo",
        screenEnabled: true,
        inputEnabled: true,
        createdAt: "2026-05-18T09:00:00.000Z",
        updatedAt: "2026-05-18T09:00:02.000Z"
      }
    }).frame
  ).toMatchObject({
    sequence: 2,
    mimeType: "image/jpeg"
  });

  expect(
    remoteControlInputRequestSchema.parse({
      event: {
        phase: "up",
        type: "pointer",
        x: 0.25,
        y: 0.75
      }
    })
  ).toEqual({
    event: {
      phase: "up",
      type: "pointer",
      x: 0.25,
      y: 0.75
    }
  });
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
pnpm --filter @abitat_reece/shared test -- schemas.test.ts
```

Expected: fail because `remoteControlFrameResponseSchema` and `remoteControlInputRequestSchema` do not exist yet.

- [ ] **Step 3: Add shared schemas**

Replace the existing `remoteControlSessionResponseSchema` in `packages/shared/src/index.core.ts` with the expanded version below, then add the frame/input schemas immediately after it:

```ts
export const remoteControlPermissionStateSchema = z.enum(["unknown", "granted", "needed"]);

export const remoteControlSessionResponseSchema = z.object({
  id: idSchema,
  status: remoteControlStatusSchema,
  hostMachineId: idSchema,
  clientMachineId: idSchema,
  screenEnabled: z.boolean(),
  inputEnabled: z.boolean(),
  permissionState: z
    .object({
      accessibility: remoteControlPermissionStateSchema.default("unknown"),
      screenRecording: remoteControlPermissionStateSchema.default("unknown")
    })
    .default(() => ({ accessibility: "unknown", screenRecording: "unknown" })),
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
});

export const remoteControlFrameSchema = z.object({
  sequence: z.number().int().nonnegative(),
  capturedAt: z.string().datetime(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.literal("image/jpeg"),
  dataBase64: z.string().min(1)
});

export const remoteControlFrameResponseSchema = z.object({
  frame: remoteControlFrameSchema.nullable(),
  session: remoteControlSessionResponseSchema
});

export const remoteControlInputRequestSchema = z.object({
  event: remoteInputEventSchema
});

export const remoteControlInputResponseSchema = z.object({
  ok: z.literal(true),
  session: remoteControlSessionResponseSchema
});
```

Update exported types near existing remote-control type exports:

```ts
export type RemoteControlFrame = z.infer<typeof remoteControlFrameSchema>;
export type RemoteControlFrameResponse = z.infer<typeof remoteControlFrameResponseSchema>;
export type RemoteControlInputRequest = z.infer<typeof remoteControlInputRequestSchema>;
export type RemoteControlInputResponse = z.infer<typeof remoteControlInputResponseSchema>;
export type RemoteControlPermissionState = z.infer<typeof remoteControlPermissionStateSchema>;
```

- [ ] **Step 4: Run shared tests**

Run:

```bash
pnpm --filter @abitat_reece/shared test -- schemas.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.core.ts packages/shared/tests/schemas.test.ts
git commit -m "feat: add local remote control schemas"
```

---

## Task 2: Host Remote-Control Manager With Fake Driver

**Files:**
- Create: `apps/host-daemon/src/local-control/remote-control/types.ts`
- Create: `apps/host-daemon/src/local-control/remote-control/session-manager.ts`
- Create: `apps/host-daemon/tests/local-remote-control-manager.test.ts`

- [ ] **Step 1: Create manager tests first**

Create `apps/host-daemon/tests/local-remote-control-manager.test.ts`:

```ts
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

      manager.endSession(session.id, "phone_demo");
      await vi.advanceTimersByTimeAsync(150);

      expect(driver.captureCount).toBe(0);
      expect(manager.getSession(session.id, "phone_demo")).toMatchObject({
        status: "ended"
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

function createFakeDriver() {
  const driver: LocalRemoteControlDriver & {
    captureCount: number;
    inputError: Error | null;
    nextFrameSequence: number;
  } = {
    captureCount: 0,
    inputError: null,
    nextFrameSequence: 1,
    async captureFrame() {
      driver.captureCount += 1;
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
    },
    async closeSession() {}
  };

  return driver;
}
```

- [ ] **Step 2: Run the new manager test and verify it fails**

Run:

```bash
pnpm --filter @abitat_reece/host-daemon test -- local-remote-control-manager.test.ts
```

Expected: fail because `session-manager.ts` does not exist.

- [ ] **Step 3: Add local remote-control types**

Create `apps/host-daemon/src/local-control/remote-control/types.ts`:

```ts
import type { RemoteControlFrame, RemoteControlStatus, RemoteInputEvent } from "@abitat_reece/shared";

export type RemoteControlPermissionState = "unknown" | "granted" | "needed";

export interface LocalRemoteControlPermissionState {
  accessibility: RemoteControlPermissionState;
  screenRecording: RemoteControlPermissionState;
}

export interface LocalRemoteControlSession {
  id: string;
  status: RemoteControlStatus;
  hostMachineId: string;
  clientMachineId: string;
  screenEnabled: boolean;
  inputEnabled: boolean;
  permissionState: LocalRemoteControlPermissionState;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalRemoteControlStartInput {
  hostMachineId: string;
  clientMachineId: string;
  screenEnabled: boolean;
  inputEnabled: boolean;
}

export interface LocalRemoteControlDriver {
  captureFrame(session: LocalRemoteControlSession): Promise<RemoteControlFrame>;
  applyInput(session: LocalRemoteControlSession, event: RemoteInputEvent): Promise<void>;
  closeSession(session: LocalRemoteControlSession): Promise<void>;
}

export interface LocalRemoteControlManager {
  applyInput(sessionId: string, clientMachineId: string, event: RemoteInputEvent): Promise<LocalRemoteControlSession>;
  captureNextFrameForTest(sessionId: string): Promise<void>;
  endSession(sessionId: string, clientMachineId: string): Promise<LocalRemoteControlSession>;
  getLatestFrame(sessionId: string, clientMachineId: string, afterSequence?: number): {
    frame: RemoteControlFrame | null;
    session: LocalRemoteControlSession;
  };
  getSession(sessionId: string, clientMachineId: string): LocalRemoteControlSession;
  listSessions(clientMachineId: string): LocalRemoteControlSession[];
  startSession(input: LocalRemoteControlStartInput): Promise<LocalRemoteControlSession>;
  stopAll(): Promise<void>;
}
```

- [ ] **Step 4: Add manager implementation**

Create `apps/host-daemon/src/local-control/remote-control/session-manager.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { RemoteControlFrame, RemoteInputEvent } from "@abitat_reece/shared";

import {
  type LocalRemoteControlDriver,
  type LocalRemoteControlManager,
  type LocalRemoteControlSession,
  type LocalRemoteControlStartInput
} from "./types.js";

interface ManagerOptions {
  driver: LocalRemoteControlDriver;
  frameIntervalMs?: number;
  idGenerator?: (prefix: string) => string;
  now?: () => Date;
}

interface SessionState {
  frameTimer: NodeJS.Timeout | null;
  latestFrame: RemoteControlFrame | null;
  session: LocalRemoteControlSession;
}

const DEFAULT_FRAME_INTERVAL_MS = 750;

export type { LocalRemoteControlDriver, LocalRemoteControlManager } from "./types.js";

export function createLocalRemoteControlManager(options: ManagerOptions): LocalRemoteControlManager {
  const states = new Map<string, SessionState>();
  const now = options.now ?? (() => new Date());
  const idGenerator =
    options.idGenerator ?? ((prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`);
  const frameIntervalMs = options.frameIntervalMs ?? DEFAULT_FRAME_INTERVAL_MS;

  async function captureNextFrame(sessionId: string) {
    const state = states.get(sessionId);
    if (!state || state.session.status === "ended" || state.session.status === "failed") {
      return;
    }

    try {
      const nextFrame = await options.driver.captureFrame(state.session);
      state.latestFrame = nextFrame;
      state.session = {
        ...state.session,
        status: "active",
        permissionState: {
          ...state.session.permissionState,
          screenRecording: "granted"
        },
        updatedAt: now().toISOString()
      };
    } catch (error) {
      state.session = {
        ...state.session,
        errorMessage: error instanceof Error ? error.message : "Unable to capture Mac screen",
        permissionState: {
          ...state.session.permissionState,
          screenRecording: permissionKind(error) === "screenRecording" ? "needed" : state.session.permissionState.screenRecording
        },
        status: permissionKind(error) === "screenRecording" ? "failed" : state.session.status,
        updatedAt: now().toISOString()
      };
    }
  }

  function startFrameLoop(state: SessionState) {
    if (!state.session.screenEnabled || state.frameTimer) {
      return;
    }

    state.frameTimer = setInterval(() => {
      void captureNextFrame(state.session.id);
    }, frameIntervalMs);
    void captureNextFrame(state.session.id);
  }

  function requireSession(sessionId: string, clientMachineId: string) {
    const state = states.get(sessionId);
    if (!state || state.session.clientMachineId !== clientMachineId) {
      throw Object.assign(new Error("Remote-control session not found"), { statusCode: 404 });
    }
    return state;
  }

  return {
    async applyInput(sessionId, clientMachineId, event) {
      const state = requireSession(sessionId, clientMachineId);
      if (!state.session.inputEnabled) {
        throw Object.assign(new Error("Remote-control input is disabled for this session"), {
          statusCode: 403
        });
      }

      try {
        await options.driver.applyInput(state.session, event);
        state.session = {
          ...state.session,
          permissionState: {
            ...state.session.permissionState,
            accessibility: "granted"
          },
          updatedAt: now().toISOString()
        };
        return state.session;
      } catch (error) {
        state.session = {
          ...state.session,
          errorMessage: error instanceof Error ? error.message : "Unable to send Mac input",
          permissionState: {
            ...state.session.permissionState,
            accessibility: permissionKind(error) === "accessibility" ? "needed" : state.session.permissionState.accessibility
          },
          updatedAt: now().toISOString()
        };
        throw error;
      }
    },
    async captureNextFrameForTest(sessionId) {
      await captureNextFrame(sessionId);
    },
    async endSession(sessionId, clientMachineId) {
      const state = requireSession(sessionId, clientMachineId);
      if (state.frameTimer) {
        clearInterval(state.frameTimer);
        state.frameTimer = null;
      }
      state.session = {
        ...state.session,
        status: "ended",
        updatedAt: now().toISOString()
      };
      await options.driver.closeSession(state.session);
      return state.session;
    },
    getLatestFrame(sessionId, clientMachineId, afterSequence = -1) {
      const state = requireSession(sessionId, clientMachineId);
      return {
        frame:
          state.latestFrame && state.latestFrame.sequence > afterSequence ? state.latestFrame : null,
        session: state.session
      };
    },
    getSession(sessionId, clientMachineId) {
      return requireSession(sessionId, clientMachineId).session;
    },
    listSessions(clientMachineId) {
      return [...states.values()]
        .map((state) => state.session)
        .filter((session) => session.clientMachineId === clientMachineId);
    },
    async startSession(input: LocalRemoteControlStartInput) {
      for (const state of states.values()) {
        if (
          state.session.clientMachineId === input.clientMachineId &&
          state.session.hostMachineId === input.hostMachineId &&
          state.session.status !== "ended" &&
          state.session.status !== "failed"
        ) {
          return state.session;
        }
      }

      const timestamp = now().toISOString();
      const session: LocalRemoteControlSession = {
        id: idGenerator("remote"),
        status: "connecting",
        hostMachineId: input.hostMachineId,
        clientMachineId: input.clientMachineId,
        screenEnabled: input.screenEnabled,
        inputEnabled: input.inputEnabled,
        permissionState: {
          accessibility: "unknown",
          screenRecording: "unknown"
        },
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const state: SessionState = {
        frameTimer: null,
        latestFrame: null,
        session
      };
      states.set(session.id, state);
      startFrameLoop(state);
      return session;
    },
    async stopAll() {
      await Promise.all(
        [...states.values()].map(async (state) => {
          if (state.frameTimer) {
            clearInterval(state.frameTimer);
            state.frameTimer = null;
          }
          await options.driver.closeSession(state.session);
        })
      );
    }
  };
}

function permissionKind(error: unknown) {
  if (typeof error === "object" && error && "permission" in error) {
    const value = (error as { permission?: unknown }).permission;
    return value === "screenRecording" || value === "accessibility" ? value : null;
  }
  return null;
}
```

- [ ] **Step 5: Run manager tests**

Run:

```bash
pnpm --filter @abitat_reece/host-daemon test -- local-remote-control-manager.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/host-daemon/src/local-control/remote-control apps/host-daemon/tests/local-remote-control-manager.test.ts
git commit -m "feat: add local remote control session manager"
```

---

## Task 3: macOS Screen Capture And Input Driver

**Files:**
- Create: `apps/host-daemon/src/local-control/remote-control/macos-driver.ts`
- Create: `apps/host-daemon/tests/macos-remote-control-driver.test.ts`

- [ ] **Step 1: Write command-construction tests**

Create `apps/host-daemon/tests/macos-remote-control-driver.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createMacOsRemoteControlDriver } from "../src/local-control/remote-control/macos-driver";
import type { LocalRemoteControlSession } from "../src/local-control/remote-control/types";

describe("macOS remote-control driver", () => {
  it("captures and compresses a JPEG frame without exposing screen data in errors", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const driver = createMacOsRemoteControlDriver({
      execFile: async (command, args) => {
        calls.push({ command, args });
        if (command === "/usr/bin/sips" && args.includes("-g")) {
          return { stderr: "", stdout: "  pixelWidth: 1170\n  pixelHeight: 731\n" };
        }
        return { stderr: "", stdout: "" };
      },
      readFile: async () => Buffer.from("jpeg-bytes"),
      unlink: async () => undefined,
      now: () => new Date("2026-05-18T09:00:00.000Z")
    });

    await expect(driver.captureFrame(session())).resolves.toMatchObject({
      dataBase64: Buffer.from("jpeg-bytes").toString("base64"),
      height: 731,
      mimeType: "image/jpeg",
      width: 1170
    });
    expect(calls.map((call) => call.command)).toEqual([
      "/usr/sbin/screencapture",
      "/usr/bin/sips",
      "/usr/bin/sips",
      "/usr/bin/sips"
    ]);
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

  it("marks accessibility permission as needed when System Events is blocked", async () => {
    const driver = createMacOsRemoteControlDriver({
      execFile: async () => {
        throw Object.assign(new Error("osascript failed"), {
          stderr: "System Events is not allowed assistive access"
        });
      }
    });

    await expect(driver.applyInput(session(), { type: "text", value: "hello" })).rejects.toMatchObject({
      message: "Accessibility permission is required for remote control input",
      permission: "accessibility"
    });
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
```

- [ ] **Step 2: Run the driver test and verify it fails**

Run:

```bash
pnpm --filter @abitat_reece/host-daemon test -- macos-remote-control-driver.test.ts
```

Expected: fail because `macos-driver.ts` does not exist.

- [ ] **Step 3: Add macOS driver**

Create `apps/host-daemon/src/local-control/remote-control/macos-driver.ts`:

```ts
import { execFile as execFileCallback } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

import type { RemoteInputEvent } from "@abitat_reece/shared";

import type { LocalRemoteControlDriver, LocalRemoteControlSession } from "./types.js";

type ExecFile = (
  command: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

interface DriverOptions {
  execFile?: ExecFile;
  now?: () => Date;
  readFile?: typeof readFile;
  unlink?: typeof unlink;
}

const runExecFile = promisify(execFileCallback) as ExecFile;
const CAPTURE_WIDTH = 1170;
const DEFAULT_DISPLAY_WIDTH = 1440;
const DEFAULT_DISPLAY_HEIGHT = 900;

export function createMacOsRemoteControlDriver(options: DriverOptions = {}): LocalRemoteControlDriver {
  const execFile = options.execFile ?? runExecFile;
  const readFrameFile = options.readFile ?? readFile;
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
        await execFile("/usr/sbin/screencapture", ["-x", "-t", "jpg", rawPath]);
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
        await execFile("/usr/bin/sips", [
          "-Z",
          String(CAPTURE_WIDTH),
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          "35",
          rawPath,
          "--out",
          framePath
        ]);
        const dimensions = await execFile("/usr/bin/sips", [
          "-g",
          "pixelWidth",
          "-g",
          "pixelHeight",
          framePath
        ]);
        const image = await readFrameFile(framePath);
        sequence += 1;

        return {
          capturedAt: now().toISOString(),
          dataBase64: image.toString("base64"),
          height: numberFromSips(dimensions.stdout, "pixelHeight") ?? DEFAULT_DISPLAY_HEIGHT,
          mimeType: "image/jpeg" as const,
          sequence,
          width: numberFromSips(dimensions.stdout, "pixelWidth") ?? CAPTURE_WIDTH
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
        await execFile("/usr/bin/osascript", ["-e", appleScriptForInput(event, screenSize)]);
      } catch (error) {
        throw normalizeInputError(error);
      }
    },
    async closeSession() {}
  };
}

function appleScriptForInput(
  event: RemoteInputEvent,
  screenSize: { height: number; width: number }
) {
  if (event.type === "text") {
    return `tell application "System Events" to keystroke ${JSON.stringify(event.value)}`;
  }

  if (event.type === "key") {
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
    return Object.assign(new Error("Accessibility permission is required for remote control input"), {
      permission: "accessibility"
    });
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
```

- [ ] **Step 4: Run driver tests**

Run:

```bash
pnpm --filter @abitat_reece/host-daemon test -- macos-remote-control-driver.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/host-daemon/src/local-control/remote-control/macos-driver.ts apps/host-daemon/tests/macos-remote-control-driver.test.ts
git commit -m "feat: add macos remote control driver"
```

---

## Task 4: Local-Control Remote Routes

**Files:**
- Create: `apps/host-daemon/src/local-control/remote-control/routes.ts`
- Modify: `apps/host-daemon/src/local-control/server.ts`
- Modify: `apps/host-daemon/tests/local-control-server.test.ts`

- [ ] **Step 1: Add server route tests**

Add a new test to `apps/host-daemon/tests/local-control-server.test.ts`:

```ts
it("serves local remote-control sessions, frames, and input only to the paired phone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "abitat-local-remote-control-"));
  const store = createLocalControlStore({
    idGenerator: (prefix) => `${prefix}_test`,
    randomSecret: (() => {
      let index = 0;
      return () => `secret_${++index}`;
    })(),
    statePath: join(directory, "state.json")
  });
  const remoteControl = createFakeRemoteControlManager();
  const server = await startLocalControlServer({
    bindHost: "127.0.0.1",
    codex: createFakeCodexBridge(),
    endpoint: "http://127.0.0.1:0",
    port: 0,
    remoteControl,
    store,
    transport: "local"
  });
  servers.push(server);

  try {
    const endpoint = server.endpoint;
    const pairing = await store.createPairing({ endpoint, transport: "local" });
    const paired = await fetchJson(`${endpoint}/pairing/consume`, {
      body: JSON.stringify({
        deviceName: "Reece iPhone",
        pairingSecret: pairing.pairingSecret,
        platform: "ios"
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const auth = { authorization: `Bearer ${paired.clientToken}` };

    await expect(
      fetchJson(`${endpoint}/api/remote-control/sessions`, {
        body: JSON.stringify({
          hostMachineId: "not_this_mac",
          inputEnabled: true,
          screenEnabled: true
        }),
        headers: { ...auth, "content-type": "application/json" },
        method: "POST"
      })
    ).rejects.toThrow("403");

    await expect(
      fetchJson(`${endpoint}/api/remote-control/sessions`, {
        body: JSON.stringify({
          hostMachineId: "mac_test",
          inputEnabled: true,
          screenEnabled: true
        }),
        headers: { ...auth, "content-type": "application/json" },
        method: "POST"
      })
    ).resolves.toMatchObject({
      session: {
        id: "remote_test",
        hostMachineId: "mac_test",
        clientMachineId: "phone_test"
      }
    });

    await expect(
      fetchJson(`${endpoint}/api/remote-control/sessions/remote_test/frame?afterSequence=0`, {
        headers: auth
      })
    ).resolves.toMatchObject({
      frame: {
        sequence: 1,
        dataBase64: "ZnJhbWU="
      }
    });

    await expect(
      fetchJson(`${endpoint}/api/remote-control/sessions/remote_test/input`, {
        body: JSON.stringify({
          event: {
            type: "text",
            value: "hello"
          }
        }),
        headers: { ...auth, "content-type": "application/json" },
        method: "POST"
      })
    ).resolves.toEqual({
      ok: true,
      session: expect.objectContaining({
        id: "remote_test"
      })
    });
    expect(remoteControl.inputEvents).toEqual([{ type: "text", value: "hello" }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
```

Add this fake manager helper at the bottom of the same test file:

```ts
function createFakeRemoteControlManager() {
  const session = {
    clientMachineId: "phone_test",
    createdAt: "2026-05-18T09:00:00.000Z",
    errorMessage: null,
    hostMachineId: "mac_test",
    id: "remote_test",
    inputEnabled: true,
    permissionState: {
      accessibility: "unknown" as const,
      screenRecording: "granted" as const
    },
    screenEnabled: true,
    status: "active" as const,
    updatedAt: "2026-05-18T09:00:01.000Z"
  };
  const inputEvents: unknown[] = [];

  return {
    inputEvents,
    async applyInput(_sessionId: string, _clientMachineId: string, event: unknown) {
      inputEvents.push(event);
      return session;
    },
    async captureNextFrameForTest() {},
    async endSession() {
      return { ...session, status: "ended" as const };
    },
    getLatestFrame() {
      return {
        frame: {
          capturedAt: "2026-05-18T09:00:01.000Z",
          dataBase64: "ZnJhbWU=",
          height: 720,
          mimeType: "image/jpeg" as const,
          sequence: 1,
          width: 1170
        },
        session
      };
    },
    getSession() {
      return session;
    },
    listSessions() {
      return [session];
    },
    async startSession() {
      return session;
    },
    async stopAll() {}
  };
}
```

- [ ] **Step 2: Run the local server test and verify it fails**

Run:

```bash
pnpm --filter @abitat_reece/host-daemon test -- local-control-server.test.ts
```

Expected: fail because `remoteControl` is not accepted by `startLocalControlServer` and routes are not delegated yet.

- [ ] **Step 3: Add route handler**

Create `apps/host-daemon/src/local-control/remote-control/routes.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  remoteControlInputRequestSchema,
  remoteControlSessionCreateRequestSchema
} from "@abitat_reece/shared";

import type { LocalPairedDevice } from "../state.js";
import { logDiagnostics, type MobileControlDiagnosticsLogger } from "../diagnostics-log.js";
import type { LocalRemoteControlManager } from "./types.js";

interface HandleRemoteControlRouteInput {
  actor: LocalPairedDevice;
  diagnostics?: MobileControlDiagnosticsLogger;
  hostMachineId: string;
  manager: LocalRemoteControlManager;
  method: string;
  path: string;
  request: IncomingMessage;
  response: ServerResponse;
  searchParams: URLSearchParams;
  readJson(request: IncomingMessage): Promise<unknown>;
  writeJson(response: ServerResponse, status: number, body: unknown): void;
}

export async function handleLocalRemoteControlRoute(input: HandleRemoteControlRouteInput) {
  if (!input.path.startsWith("/api/remote-control/") && input.path !== "/remote-control/status") {
    return false;
  }

  if (input.method === "GET" && input.path === "/remote-control/status") {
    input.writeJson(input.response, 200, {
      sessions: input.manager.listSessions(input.actor.id)
    });
    return true;
  }

  if (input.method === "GET" && input.path === "/api/remote-control/sessions") {
    input.writeJson(input.response, 200, {
      sessions: input.manager.listSessions(input.actor.id)
    });
    return true;
  }

  if (input.method === "POST" && input.path === "/api/remote-control/sessions") {
    const body = remoteControlSessionCreateRequestSchema.parse(await input.readJson(input.request));
    if (body.hostMachineId !== input.hostMachineId) {
      throw Object.assign(new Error("Phone is not paired to this Mac host"), { statusCode: 403 });
    }
    const session = await input.manager.startSession({
      clientMachineId: input.actor.id,
      hostMachineId: body.hostMachineId,
      inputEnabled: body.inputEnabled,
      screenEnabled: body.screenEnabled
    });
    logDiagnostics(input.diagnostics, "info", "remote_control.session.start", {
      deviceId: input.actor.id,
      hostMachineId: body.hostMachineId,
      inputEnabled: body.inputEnabled,
      screenEnabled: body.screenEnabled,
      sessionId: session.id
    });
    input.writeJson(input.response, 201, { session });
    return true;
  }

  const sessionMatch = input.path.match(/^\/api\/remote-control\/sessions\/([^/]+)$/u);
  if (sessionMatch && input.method === "GET") {
    input.writeJson(input.response, 200, {
      session: input.manager.getSession(decodeURIComponent(sessionMatch[1]), input.actor.id)
    });
    return true;
  }

  if (sessionMatch && input.method === "DELETE") {
    const session = await input.manager.endSession(
      decodeURIComponent(sessionMatch[1]),
      input.actor.id
    );
    input.writeJson(input.response, 200, { session });
    return true;
  }

  const frameMatch = input.path.match(/^\/api\/remote-control\/sessions\/([^/]+)\/frame$/u);
  if (frameMatch && input.method === "GET") {
    const afterSequence = Number(input.searchParams.get("afterSequence") ?? "-1");
    input.writeJson(
      input.response,
      200,
      input.manager.getLatestFrame(
        decodeURIComponent(frameMatch[1]),
        input.actor.id,
        Number.isFinite(afterSequence) ? afterSequence : -1
      )
    );
    return true;
  }

  const inputMatch = input.path.match(/^\/api\/remote-control\/sessions\/([^/]+)\/input$/u);
  if (inputMatch && input.method === "POST") {
    const body = remoteControlInputRequestSchema.parse(await input.readJson(input.request));
    const session = await input.manager.applyInput(
      decodeURIComponent(inputMatch[1]),
      input.actor.id,
      body.event
    );
    input.writeJson(input.response, 200, { ok: true, session });
    return true;
  }

  return false;
}
```

- [ ] **Step 4: Wire routes into local-control server**

Modify `apps/host-daemon/src/local-control/server.ts`:

```ts
import { createMacOsRemoteControlDriver } from "./remote-control/macos-driver.js";
import { handleLocalRemoteControlRoute } from "./remote-control/routes.js";
import {
  createLocalRemoteControlManager,
  type LocalRemoteControlManager
} from "./remote-control/session-manager.js";
```

Extend `StartLocalControlServerInput`:

```ts
remoteControl?: LocalRemoteControlManager;
```

Create the manager once inside `startLocalControlServer`:

```ts
const remoteControl =
  input.remoteControl ??
  createLocalRemoteControlManager({
    driver: createMacOsRemoteControlDriver()
  });
```

After authentication and before the existing inline remote-control stub block, delegate:

```ts
if (
  await handleLocalRemoteControlRoute({
    actor,
    diagnostics,
    hostMachineId: identity.macId,
    manager: remoteControl,
    method,
    path,
    readJson,
    request,
    response,
    searchParams: url.searchParams,
    writeJson
  })
) {
  return;
}
```

Remove the old inline in-memory `sessions` and `signals` variables only after the route handler passes tests. Keep legacy `/api/remote-control/sessions/:id/signals` returning `404` or route it to the existing signal block only if existing tests require it.

Update `server.close()` to stop active capture loops:

```ts
close: async () => {
  await remoteControl.stopAll();
  await closeServer(server);
}
```

- [ ] **Step 5: Run host-daemon tests for local control and manager**

Run:

```bash
pnpm --filter @abitat_reece/host-daemon test -- local-control-server.test.ts local-remote-control-manager.test.ts macos-remote-control-driver.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/host-daemon/src/local-control/server.ts apps/host-daemon/src/local-control/remote-control/routes.ts apps/host-daemon/tests/local-control-server.test.ts
git commit -m "feat: expose local remote control routes"
```

---

## Task 5: iOS API Client For Frames And Input

**Files:**
- Modify: `apps/ios/src/types.ts`
- Modify: `apps/ios/src/api/client.ts`
- Modify: `apps/ios/scripts/validate-ios-app.mjs`

- [ ] **Step 1: Extend iOS validator first**

Add checks in `apps/ios/scripts/validate-ios-app.mjs` near the existing remote-control check:

```js
for (const expected of [
  "getRemoteSession",
  "getRemoteFrame",
  "sendRemoteInput",
  "/api/remote-control/sessions/${sessionId}/frame",
  "/api/remote-control/sessions/${sessionId}/input"
]) {
  if (!apiClient.includes(expected)) {
    throw new Error(`Expected API client to support local remote-control frame/input APIs: ${expected}`);
  }
}
```

- [ ] **Step 2: Run iOS validator and verify it fails**

Run:

```bash
pnpm --filter abitat-ios test
```

Expected: fail because the client methods do not exist yet.

- [ ] **Step 3: Add iOS types**

Modify `apps/ios/src/types.ts`:

```ts
export type RemoteControlPermissionState = "unknown" | "granted" | "needed";

export interface RemoteControlSession {
  id: string;
  status: "requested" | "connecting" | "active" | "ended" | "failed";
  hostMachineId: string;
  clientMachineId: string;
  screenEnabled: boolean;
  inputEnabled: boolean;
  permissionState?: {
    accessibility: RemoteControlPermissionState;
    screenRecording: RemoteControlPermissionState;
  };
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RemoteControlFrame {
  sequence: number;
  capturedAt: string;
  width: number;
  height: number;
  mimeType: "image/jpeg";
  dataBase64: string;
}

export type RemoteControlInputEvent =
  | {
      type: "pointer";
      phase: "down" | "move" | "up" | "scroll";
      x: number;
      y: number;
      buttons?: number;
      dx?: number;
      dy?: number;
    }
  | {
      type: "text";
      value: string;
    }
  | {
      type: "key";
      key: string;
      code?: string;
      modifiers: Array<"cmd" | "ctrl" | "alt" | "shift">;
    };
```

- [ ] **Step 4: Add API methods**

Modify `ApiClient` in `apps/ios/src/api/client.ts`:

```ts
  getRemoteFrame(
    sessionId: string,
    afterSequence?: number
  ): Promise<{ frame: RemoteControlFrame | null; session: RemoteControlSession }>;
  getRemoteSession(sessionId: string): Promise<RemoteControlSession>;
  sendRemoteInput(
    sessionId: string,
    event: RemoteControlInputEvent
  ): Promise<RemoteControlSession>;
```

Import the new types:

```ts
RemoteControlFrame,
RemoteControlInputEvent,
```

Add implementations in `createApiClient`:

```ts
    getRemoteFrame: (sessionId, afterSequence) =>
      get(
        pairing,
        `/api/remote-control/sessions/${sessionId}/frame${
          Number.isFinite(afterSequence) ? `?afterSequence=${afterSequence}` : ""
        }`
      ).then(
        (body) =>
          body as {
            frame: RemoteControlFrame | null;
            session: RemoteControlSession;
          }
      ),
    getRemoteSession: (sessionId) =>
      get(pairing, `/api/remote-control/sessions/${sessionId}`).then(
        (body) => body.session as RemoteControlSession
      ),
    sendRemoteInput: (sessionId, event) =>
      post(pairing, `/api/remote-control/sessions/${sessionId}/input`, { event }).then(
        (body) => body.session as RemoteControlSession
      ),
```

- [ ] **Step 5: Run iOS validator and typecheck**

Run:

```bash
pnpm --filter abitat-ios test
pnpm --filter abitat-ios typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/ios/src/types.ts apps/ios/src/api/client.ts apps/ios/scripts/validate-ios-app.mjs
git commit -m "feat: add mobile remote control api client"
```

---

## Task 6: Route Remote Control From The Dashboard Without Touching Project Flows

**Files:**
- Modify: `apps/ios/src/types.ts`
- Modify: `apps/ios/src/App.tsx`
- Modify: `apps/ios/src/screens/SettingsScreen.tsx`
- Modify: `apps/ios/scripts/validate-ios-app.mjs`

- [ ] **Step 1: Extend validator for isolated route**

Add checks in `apps/ios/scripts/validate-ios-app.mjs`:

```js
for (const expected of [
  '| "remoteControl"',
  "RemoteControlScreen",
  "remoteControlStartKey",
  "startRemoteControlFromDashboard",
  'navigateToRoute("remoteControl")',
  "onStartRemoteControl={startRemoteControlFromDashboard}",
  "routeName === \"remoteControl\""
]) {
  if (!appScreen.includes(expected) && !settingsScreen.includes(expected) && !typesFile.includes(expected)) {
    throw new Error(`Expected isolated remote-control route wiring: ${expected}`);
  }
}
```

If the validator does not currently read `settingsScreen` or `typesFile`, add:

```js
const settingsScreen = await readFile(join(process.cwd(), "src/screens/SettingsScreen.tsx"), "utf8");
const typesFile = await readFile(join(process.cwd(), "src/types.ts"), "utf8");
```

- [ ] **Step 2: Run iOS validator and verify it fails**

Run:

```bash
pnpm --filter abitat-ios test
```

Expected: fail because the route is not wired.

- [ ] **Step 3: Add route type**

Modify `apps/ios/src/types.ts`:

```ts
export type RouteName =
  | "pairing"
  | "workspace"
  | "projects"
  | "remoteControl"
  | "conversation"
  | "settings";
```

- [ ] **Step 4: Wire App route**

Modify `apps/ios/src/App.tsx`:

```ts
import { RemoteControlScreen } from "./screens/RemoteControlScreen";
```

Add dashboard-start state near the other route state:

```ts
const [remoteControlStartKey, setRemoteControlStartKey] = useState(0);
```

Add a route helper near the other navigation callbacks:

```ts
const startRemoteControlFromDashboard = useCallback(() => {
  setRemoteControlStartKey((current) => current + 1);
  navigateToRoute("remoteControl");
}, [navigateToRoute]);
```

Add route rendering before conversation route rendering:

```tsx
if (routeName === "remoteControl") {
  return (
    <RemoteControlScreen
      api={store.api}
      autoStartKey={remoteControlStartKey}
      hostMachineId={store.pairing?.hostMachineId ?? store.pairing?.macId ?? ""}
      onBack={goBackOneLevel}
    />
  );
}
```

Update settings screen rendering:

```tsx
<SettingsScreen
  api={store.api}
  onBack={goBackOneLevel}
  onStartRemoteControl={startRemoteControlFromDashboard}
  onSignOut={() => {
    void store.signOut();
    setRoute("projects");
  }}
/>
```

Update `routeBackOneLevel`:

```ts
if (route === "remoteControl" || route === "settings" || route === "workspace") {
  return "projects";
}
```

- [ ] **Step 5: Add Settings entry point**

Add the icon import at the top of `apps/ios/src/screens/SettingsScreen.tsx`:

```ts
import { Feather } from "@expo/vector-icons";
```

Extend `SettingsScreenProps`:

```ts
interface SettingsScreenProps {
  api: ApiClient;
  onBack(): void;
  onStartRemoteControl(): void;
  onSignOut(): void;
}
```

Read the new prop in the component signature:

```ts
export function SettingsScreen({ api, onStartRemoteControl, onSignOut }: SettingsScreenProps) {
```

The existing `onBack` prop can stay in the type for the current app contract even if the current settings layout does not render a back button.

Add a button in the dashboard actions area, above Request Log and Disconnect:

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel="Start remote control"
  onPress={onStartRemoteControl}
  style={({ pressed }) => [
    styles.remoteControlButton,
    pressed ? styles.buttonPressed : null
  ]}
>
  <Feather color="#f5f5f5" name="monitor" size={20} />
  <Text style={styles.remoteControlButtonText}>START REMOTE CONTROL</Text>
  <Feather color="#8b949e" name="chevron-right" size={18} />
</Pressable>
```

Add styles:

```ts
remoteControlButton: {
  alignItems: "center",
  borderColor: "rgba(255,255,255,0.18)",
  borderRadius: 4,
  borderWidth: 1,
  flexDirection: "row",
  gap: 12,
  justifyContent: "center",
  minHeight: 46,
  minWidth: 272,
  paddingHorizontal: 18
},
remoteControlButtonText: {
  color: "#f3f3f3",
  flex: 1,
  fontSize: 12,
  fontWeight: "400",
  letterSpacing: 3,
  lineHeight: 16
}
```

- [ ] **Step 6: Run iOS checks**

Run:

```bash
pnpm --filter abitat-ios test
pnpm --filter abitat-ios typecheck
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add apps/ios/src/types.ts apps/ios/src/App.tsx apps/ios/src/screens/SettingsScreen.tsx apps/ios/scripts/validate-ios-app.mjs
git commit -m "feat: start mobile remote control from dashboard"
```

---

## Task 7: Replace iOS Placeholder Remote Screen With Polling MVP

**Files:**
- Modify: `apps/ios/src/screens/RemoteControlScreen.tsx`
- Modify: `apps/ios/scripts/validate-ios-app.mjs`

- [ ] **Step 1: Extend validator for polling UI**

Add checks:

```js
for (const expected of [
  "getRemoteFrame",
  "sendRemoteInput",
  "autoStartKey",
  "startSessionFromDashboard",
  "lastFrameSequenceRef",
  "Image",
  "data:image/jpeg;base64,${frame.dataBase64}",
  "permissionState",
  "Screen Recording",
  "Accessibility",
  "onTouchEnd",
  "keyboardAppearance=\"dark\""
]) {
  if (!remoteControlScreen.includes(expected)) {
    throw new Error(`Expected RemoteControlScreen polling MVP behavior: ${expected}`);
  }
}
```

- [ ] **Step 2: Run iOS validator and verify it fails**

Run:

```bash
pnpm --filter abitat-ios test
```

Expected: fail because the screen still uses placeholder signal polling.

- [ ] **Step 3: Replace screen state and polling**

In `apps/ios/src/screens/RemoteControlScreen.tsx`, use this component shape:

```tsx
interface RemoteControlScreenProps {
  api: ApiClient;
  autoStartKey: number;
  hostMachineId: string;
  onBack(): void;
}

export function RemoteControlScreen({
  api,
  autoStartKey,
  hostMachineId,
  onBack
}: RemoteControlScreenProps) {
  const [session, setSession] = useState<RemoteControlSession | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [keyboardText, setKeyboardText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [surfaceSize, setSurfaceSize] = useState({ height: 1, width: 1 });
  const lastFrameSequenceRef = useRef(-1);
  const startedAutoStartKeyRef = useRef(0);

  useEffect(() => {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    let cancelled = false;
    const timer = setInterval(() => {
      api
        .getRemoteFrame(session.id, lastFrameSequenceRef.current)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setSession(result.session);
          if (result.frame) {
            lastFrameSequenceRef.current = result.frame.sequence;
            setFrameUri(`data:image/jpeg;base64,${result.frame.dataBase64}`);
          }
        })
        .catch((caught) => {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : "Unable to refresh Mac screen");
          }
        });
    }, 750);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, session?.id, session?.status]);
```

- [ ] **Step 4: Add dashboard-triggered start and end handlers**

```tsx
useEffect(() => {
  if (!hostMachineId || autoStartKey <= 0 || startedAutoStartKeyRef.current === autoStartKey) {
    return;
  }

  startedAutoStartKeyRef.current = autoStartKey;
  void startSessionFromDashboard();
}, [autoStartKey, hostMachineId]);

async function startSessionFromDashboard() {
  setError(null);
  lastFrameSequenceRef.current = -1;
  setFrameUri(null);

  try {
    setSession(await api.createRemoteSession(hostMachineId));
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : "Unable to start remote control");
  }
}

async function end() {
  if (!session) {
    return;
  }

  try {
    setSession(await api.endRemoteSession(session.id));
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : "Unable to end remote control");
  }
}
```

- [ ] **Step 5: Add input handlers**

```tsx
async function sendTap(event: NativeSyntheticEvent<NativeTouchEvent>) {
  if (!session || session.status === "ended" || session.status === "failed") {
    return;
  }

  const touch = event.nativeEvent;
  const x = clamp01(touch.locationX / surfaceSize.width);
  const y = clamp01(touch.locationY / surfaceSize.height);

  try {
    setSession(
      await api.sendRemoteInput(session.id, {
        phase: "up",
        type: "pointer",
        x,
        y
      })
    );
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : "Unable to send tap");
  }
}

async function sendText() {
  if (!session || keyboardText.trim().length === 0) {
    return;
  }

  try {
    setSession(
      await api.sendRemoteInput(session.id, {
        type: "text",
        value: keyboardText
      })
    );
    setKeyboardText("");
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : "Unable to send text");
  }
}
```

- [ ] **Step 6: Add permission-aware UI**

Render:

```tsx
<Screen>
  <Header eyebrow="Remote Control" title="Mac Screen" subtitle="Whole Mac screen from this paired host." />

  <View style={sharedStyles.card}>
    <View style={[sharedStyles.row, { justifyContent: "space-between" }]}>
      <Text style={sharedStyles.value}>{session ? session.status : "Not connected"}</Text>
      <StatusPill status={session?.status ?? "pending"} />
    </View>
    {permissionMessage(session) ? (
      <Text style={[sharedStyles.subtitle, { color: colors.warning }]}>
        {permissionMessage(session)}
      </Text>
    ) : null}
    {error ? <Text style={[sharedStyles.subtitle, { color: colors.danger }]}>{error}</Text> : null}
  </View>

  <View
    onLayout={(event) =>
      setSurfaceSize({
        height: Math.max(1, event.nativeEvent.layout.height),
        width: Math.max(1, event.nativeEvent.layout.width)
      })
    }
    onTouchEnd={(event) => void sendTap(event)}
    style={styles.remoteSurface}
  >
    {frameUri ? (
      <Image resizeMode="contain" source={{ uri: frameUri }} style={styles.remoteFrame} />
    ) : (
      <Text style={styles.remotePlaceholder}>Waiting for Mac screen</Text>
    )}
  </View>

  <View style={sharedStyles.card}>
    <TextInput
      keyboardAppearance="dark"
      onChangeText={setKeyboardText}
      placeholder="Type to Mac"
      placeholderTextColor={colors.muted}
      style={sharedStyles.input}
      value={keyboardText}
    />
    <View style={{ marginTop: 10 }}>
      <Button disabled={!session || session.status === "ended"} onPress={sendText}>
        Send Text
      </Button>
    </View>
  </View>

  {session && session.status !== "ended" ? (
    <Button onPress={end} variant="danger">End Session</Button>
  ) : (
    <Text style={sharedStyles.subtitle}>
      Start remote control from the dashboard.
    </Text>
  )}
  <Button onPress={onBack} variant="secondary">Back to Dashboard</Button>
</Screen>
```

Add helper:

```ts
function permissionMessage(session: RemoteControlSession | null) {
  if (session?.permissionState?.screenRecording === "needed") {
    return "Screen Recording permission is needed on the Mac.";
  }
  if (session?.permissionState?.accessibility === "needed") {
    return "Accessibility permission is needed on the Mac.";
  }
  return null;
}
```

Add stable surface styles:

```ts
remoteSurface: {
  alignItems: "center",
  aspectRatio: 9 / 16,
  backgroundColor: "#05070b",
  borderColor: "#1f2937",
  borderRadius: 8,
  borderWidth: 1,
  justifyContent: "center",
  overflow: "hidden",
  width: "100%"
},
remoteFrame: {
  height: "100%",
  width: "100%"
},
remotePlaceholder: {
  color: colors.muted,
  fontSize: 13,
  textAlign: "center"
}
```

- [ ] **Step 7: Run iOS checks**

Run:

```bash
pnpm --filter abitat-ios test
pnpm --filter abitat-ios typecheck
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add apps/ios/src/screens/RemoteControlScreen.tsx apps/ios/scripts/validate-ios-app.mjs
git commit -m "feat: add mobile remote control screen"
```

---

## Task 8: Keep Legacy Signal Endpoints Harmless

**Files:**
- Modify: `apps/host-daemon/src/local-control/remote-control/routes.ts`
- Modify: `apps/host-daemon/tests/local-control-server.test.ts`
- Modify: `apps/ios/src/api/client.ts`

- [ ] **Step 1: Add tests for harmless legacy endpoints**

Add to the remote-control server test:

```ts
await expect(
  fetchJson(`${endpoint}/api/remote-control/sessions/remote_test/signals`, {
    headers: auth
  })
).resolves.toEqual({
  signals: []
});

await expect(
  fetchJson(`${endpoint}/api/remote-control/sessions/remote_test/signals`, {
    body: JSON.stringify({
      payload: {
        ignored: true
      },
      type: "status"
    }),
    headers: { ...auth, "content-type": "application/json" },
    method: "POST"
  })
).resolves.toMatchObject({
  signal: {
    type: "status"
  }
});
```

- [ ] **Step 2: Implement compatibility responses**

In `routes.ts`, before returning `false`, add:

```ts
const signalMatch = input.path.match(/^\/api\/remote-control\/sessions\/([^/]+)\/signals$/u);
if (signalMatch && input.method === "GET") {
  input.manager.getSession(decodeURIComponent(signalMatch[1]), input.actor.id);
  input.writeJson(input.response, 200, { signals: [] });
  return true;
}

if (signalMatch && input.method === "POST") {
  const body = await input.readJson(input.request);
  input.manager.getSession(decodeURIComponent(signalMatch[1]), input.actor.id);
  input.writeJson(input.response, 201, {
    signal: {
      createdAt: new Date().toISOString(),
      id: "signal_compat",
      payload: typeof body === "object" && body && "payload" in body ? (body as { payload: unknown }).payload : {},
      senderMachineId: input.actor.id,
      sessionId: decodeURIComponent(signalMatch[1]),
      type: typeof body === "object" && body && "type" in body ? (body as { type: unknown }).type : "status"
    }
  });
  return true;
}
```

- [ ] **Step 3: Keep iOS signal methods but stop using them**

Do not remove `listRemoteSignals` or `sendRemoteSignal` from `apps/ios/src/api/client.ts` in this task. They are no longer used by `RemoteControlScreen`, but leaving them avoids a needless compatibility break.

- [ ] **Step 4: Run host and iOS checks**

Run:

```bash
pnpm --filter @abitat_reece/host-daemon test -- local-control-server.test.ts
pnpm --filter abitat-ios test
pnpm --filter abitat-ios typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/host-daemon/src/local-control/remote-control/routes.ts apps/host-daemon/tests/local-control-server.test.ts apps/ios/src/api/client.ts
git commit -m "fix: keep remote control signal endpoints compatible"
```

---

## Task 9: Full Verification And Manual Test Script

**Files:**
- Modify: `docs/runbooks/common-failures.md`
- Modify: `docs/acceptance/local-first-mobile-control.md`

- [ ] **Step 1: Add remote-control acceptance notes**

Add to `docs/acceptance/local-first-mobile-control.md`:

```md
## Whole Mac Remote Control Acceptance

1. Start the Mac host with `abitat iphone`.
2. Pair the iPhone with the QR/manual payload from that Mac.
3. Open the dashboard page that shows token usage, Request Log, and Disconnect.
4. Tap START REMOTE CONTROL on that dashboard page.
5. If macOS permission is missing, the iPhone shows Screen Recording or Accessibility as needed and existing project/thread functions still work.
6. After granting permission, return to the dashboard and tap START REMOTE CONTROL again; the phone shows a whole-Mac frame.
7. Tapping the frame sends a click to the Mac.
8. Typing text and pressing Send Text enters that text on the Mac.
9. Tap End Session.
10. Return to Projects and confirm projects, expanded threads, archive, unread LEDs, chat, queue/steer, logs, token dashboard, generated files, and notifications still behave as before.
```

- [ ] **Step 2: Add runbook permission notes**

Add to `docs/runbooks/common-failures.md`:

```md
## Remote Control Shows Permission Needed

Screen Recording is required for the host daemon to capture the Mac screen. Accessibility is required for the host daemon to send keyboard and click input through System Events.

After changing either permission in macOS System Settings, stop and restart `abitat iphone`, then return to the iPhone dashboard and tap START REMOTE CONTROL again.
```

- [ ] **Step 3: Run targeted checks**

Run:

```bash
pnpm --filter @abitat_reece/shared test -- schemas.test.ts
pnpm --filter @abitat_reece/host-daemon test -- local-remote-control-manager.test.ts macos-remote-control-driver.test.ts local-control-server.test.ts
pnpm --filter abitat-ios test
pnpm --filter abitat-ios typecheck
```

Expected: all pass.

- [ ] **Step 4: Run full repo checks**

Run:

```bash
pnpm test
```

Expected: all workspace tests pass.

- [ ] **Step 5: Manual local test**

Run on the Mac:

```bash
pnpm --filter @abitat_reece/host-daemon build
pnpm --filter abitat-ios typecheck
abitat iphone
```

Then on iPhone:

1. Pair with the Mac shown by `abitat iphone`.
2. Open the dashboard page with token usage, Request Log, and Disconnect.
3. Tap START REMOTE CONTROL.
4. Confirm a whole-Mac frame appears or a permission-needed state appears.
5. If permissions are needed, grant Screen Recording and Accessibility to the terminal/app running `abitat iphone`, restart `abitat iphone`, return to the dashboard, and tap START REMOTE CONTROL again.
6. Tap a safe area on the Mac frame.
7. Put focus in a text field on the Mac and send text from the phone.
8. End the session.
9. Return to Projects and send a normal Codex message from mobile.

- [ ] **Step 6: Commit docs and verification updates**

```bash
git add docs/acceptance/local-first-mobile-control.md docs/runbooks/common-failures.md
git commit -m "docs: add remote control acceptance runbook"
```

---

## Risk Controls

- The feature is inactive until the dashboard START REMOTE CONTROL action opens `RemoteControlScreen`, which then calls `createRemoteSession`.
- The host daemon creates the macOS driver lazily enough that tests can inject a fake driver and normal project APIs do not invoke screen capture.
- The manager stores only `latestFrame`; it does not append frames to logs, arrays, or files.
- Session lookup always checks `clientMachineId`.
- Session start always checks `hostMachineId === identity.macId`.
- The input endpoint accepts only `remoteControlInputRequestSchema`.
- Diagnostics log session ids, statuses, permission states, and booleans only.
- iOS remote control starts from the existing dashboard/Settings screen, not from Projects or Conversation, so existing navigation flows stay stable.

## Known MVP Limits

- Frame transport is polling, not WebRTC.
- FPS is intentionally low to protect CPU, battery, relay latency, and memory.
- Pointer support starts with tap/click and basic scroll.
- Text and key events depend on macOS Accessibility permission.
- Screen capture depends on macOS Screen Recording permission.
- Multi-display support uses the full default screen capture first; display selection can be added after the first working version is verified.

## Completion Criteria

- `pnpm test` passes.
- `pnpm --filter abitat-ios typecheck` passes.
- A paired phone can start and end a local remote-control session.
- Wrong-host session start returns `403`.
- Unauthenticated remote-control requests return `401`.
- The phone can receive a whole-Mac JPEG frame.
- The phone can send text input to the Mac when Accessibility permission is granted.
- The phone shows a clear permission-needed state when Screen Recording or Accessibility is missing.
- Existing mobile project/thread/chat/archive/token/log/generated-file/notification flows continue to pass automated tests.
