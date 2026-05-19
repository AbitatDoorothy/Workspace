import type {
  RemoteControlCursorPosition,
  RemoteControlFrame,
  RemoteControlStatus,
  RemoteControlTextTarget,
  RemoteInputEvent
} from "@abitat_reece/shared";

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
  cursorPosition?: RemoteControlCursorPosition | null;
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
  applyInput(
    session: LocalRemoteControlSession,
    event: RemoteInputEvent
  ): Promise<{ cursorPosition?: RemoteControlCursorPosition | null } | void>;
  closeSession(session: LocalRemoteControlSession): Promise<void>;
  getCursorPosition?(): Promise<RemoteControlCursorPosition | null>;
  getTextInputTarget?(): Promise<RemoteControlTextTarget | null>;
}

export interface LocalRemoteControlManager {
  applyInput(
    sessionId: string,
    clientMachineId: string,
    event: RemoteInputEvent
  ): Promise<LocalRemoteControlSession>;
  captureNextFrameForTest(sessionId: string): Promise<void>;
  endSession(sessionId: string, clientMachineId: string): Promise<LocalRemoteControlSession>;
  getLatestFrame(
    sessionId: string,
    clientMachineId: string,
    afterSequence?: number
  ): {
    frame: RemoteControlFrame | null;
    session: LocalRemoteControlSession;
  };
  getSession(sessionId: string, clientMachineId: string): LocalRemoteControlSession;
  getTextInputTarget(
    sessionId: string,
    clientMachineId: string
  ): Promise<RemoteControlTextTarget | null>;
  listSessions(clientMachineId: string): LocalRemoteControlSession[];
  startSession(input: LocalRemoteControlStartInput): Promise<LocalRemoteControlSession>;
  stopAll(): Promise<void>;
}
