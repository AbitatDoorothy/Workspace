import { randomUUID } from "node:crypto";

import type { RemoteControlCursorPosition, RemoteControlFrame } from "@abitat_reece/shared";

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
  isFrameCaptureInFlight: boolean;
  latestFrame: RemoteControlFrame | null;
  session: LocalRemoteControlSession;
}

const DEFAULT_FRAME_INTERVAL_MS = 120;
const stoppedStatuses = new Set(["ended", "failed"]);

export type { LocalRemoteControlDriver, LocalRemoteControlManager } from "./types.js";

export function createLocalRemoteControlManager(
  options: ManagerOptions
): LocalRemoteControlManager {
  const states = new Map<string, SessionState>();
  const now = options.now ?? (() => new Date());
  const idGenerator =
    options.idGenerator ??
    ((prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`);
  const frameIntervalMs = options.frameIntervalMs ?? DEFAULT_FRAME_INTERVAL_MS;

  async function captureNextFrame(sessionId: string) {
    const state = states.get(sessionId);
    if (!state || stoppedStatuses.has(state.session.status)) {
      return;
    }
    if (state.isFrameCaptureInFlight) {
      return;
    }

    state.isFrameCaptureInFlight = true;
    try {
      const nextFrame = await options.driver.captureFrame(state.session);
      if (stoppedStatuses.has(state.session.status)) {
        return;
      }
      state.latestFrame = nextFrame;
      state.session = {
        ...state.session,
        errorMessage: null,
        permissionState: {
          ...state.session.permissionState,
          screenRecording: "granted"
        },
        status: "active",
        updatedAt: now().toISOString()
      };
    } catch (error) {
      if (stoppedStatuses.has(state.session.status)) {
        return;
      }
      const permission = permissionKind(error);
      state.session = {
        ...state.session,
        errorMessage: error instanceof Error ? error.message : "Unable to capture Mac screen",
        permissionState: {
          ...state.session.permissionState,
          screenRecording:
            permission === "screenRecording" ? "needed" : state.session.permissionState.screenRecording
        },
        status: permission === "screenRecording" ? "failed" : state.session.status,
        updatedAt: now().toISOString()
      };
    } finally {
      state.isFrameCaptureInFlight = false;
    }
  }

  function startFrameLoop(state: SessionState) {
    if (!state.session.screenEnabled || state.frameTimer) {
      return;
    }

    state.frameTimer = setInterval(() => {
      void captureNextFrame(state.session.id);
    }, frameIntervalMs);
    state.frameTimer.unref?.();
    void captureNextFrame(state.session.id);
  }

  function requireSession(sessionId: string, clientMachineId: string) {
    const state = states.get(sessionId);
    if (!state || state.session.clientMachineId !== clientMachineId) {
      throw Object.assign(new Error("Remote-control session not found"), { statusCode: 404 });
    }
    return state;
  }

  function activeSessionFor(input: LocalRemoteControlStartInput) {
    return [...states.values()].find(
      (state) =>
        state.session.clientMachineId === input.clientMachineId &&
        state.session.hostMachineId === input.hostMachineId &&
        !stoppedStatuses.has(state.session.status)
    );
  }

  async function readCursorPosition(): Promise<RemoteControlCursorPosition | null> {
    if (!options.driver.getCursorPosition) {
      return null;
    }

    try {
      return await options.driver.getCursorPosition();
    } catch {
      return null;
    }
  }

  return {
    async applyInput(sessionId, clientMachineId, event) {
      const state = requireSession(sessionId, clientMachineId);
      if (stoppedStatuses.has(state.session.status)) {
        throw Object.assign(new Error("Remote-control session is not active"), {
          statusCode: 409
        });
      }
      if (!state.session.inputEnabled) {
        throw Object.assign(new Error("Remote-control input is disabled for this session"), {
          statusCode: 403
        });
      }

      try {
        const inputResult = await options.driver.applyInput(state.session, event);
        const cursorPosition =
          inputResult && "cursorPosition" in inputResult
            ? inputResult.cursorPosition
            : state.session.cursorPosition;
        state.session = {
          ...state.session,
          cursorPosition,
          errorMessage: null,
          permissionState: {
            ...state.session.permissionState,
            accessibility: "granted"
          },
          updatedAt: now().toISOString()
        };
        return state.session;
      } catch (error) {
        const permission = permissionKind(error);
        state.session = {
          ...state.session,
          errorMessage: error instanceof Error ? error.message : "Unable to send Mac input",
          permissionState: {
            ...state.session.permissionState,
            accessibility:
              permission === "accessibility" ? "needed" : state.session.permissionState.accessibility
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
      state.latestFrame = null;
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
    async startSession(input) {
      const existing = activeSessionFor(input);
      if (existing) {
        return existing.session;
      }

      const timestamp = now().toISOString();
      const cursorPosition = await readCursorPosition();
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
        cursorPosition,
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const state: SessionState = {
        frameTimer: null,
        isFrameCaptureInFlight: false,
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
