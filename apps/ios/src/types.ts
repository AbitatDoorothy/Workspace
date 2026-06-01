export type RouteName =
  | "automations"
  | "pairing"
  | "workspace"
  | "projects"
  | "remoteControl"
  | "conversation"
  | "settings";

export interface PairingState {
  apiUrl: string;
  clientToken: string;
  hostMachineId: string;
  macId?: string;
  machineId: string;
  relayId?: string;
  transport?: "local" | "tailscale" | "quick-tunnel" | "manual" | "relay";
  workspaceId: string;
}

export interface LocalPairingPayload {
  version: 1;
  product: "abitat";
  endpoint: string;
  macId: string;
  pairingSecret: string;
  manualCode?: string;
  expiresAt: string;
  relayId?: string;
  transport: "local" | "tailscale" | "quick-tunnel" | "manual" | "relay";
  capabilities?: string[];
}

export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface DeviceSummary {
  id: string;
  name: string;
  status: "pending" | "online" | "offline" | "error";
}

export interface MobileBootstrap {
  workspace: WorkspaceSummary;
  phone: DeviceSummary;
  host: DeviceSummary | null;
}

export interface ProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  repoUrl: string;
  hostLocalPath?: string | null;
  repoSyncStatus: string;
  conversationCount?: number;
  source?: "abitat" | "codex_app";
}

export interface ConversationSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  prompt: string;
  status: string;
  type: string;
  codexDeepLink?: string;
  createdAt?: string;
  runtimeSessionId?: string | null;
  mobileOpenState?: "mac_running" | "phone_active" | "ready";
  source?: "abitat" | "codex_app";
  updatedAt?: string;
  worktreePath?: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sequence: number;
  role: "user" | "assistant" | "system" | "runtime";
  sourceDeviceId?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationAttachment {
  kind: "file" | "image";
  mimeType: string;
  name: string;
  path: string;
  size: number;
}

export interface GeneratedFileSummary {
  id: string;
  mimeType: string;
  name: string;
  path: string;
  size: number;
}

export interface GeneratedFileDownload extends GeneratedFileSummary {
  dataBase64: string;
}

export interface MobileDiagnosticsLogDownload {
  clearedAt: string;
  dataBase64: string;
  mimeType: "text/plain";
  name: string;
  size: number;
  totalSize: number;
  truncated: boolean;
}

export type CodexTokenUsageTimeframe = "1d" | "7d" | "all";

export interface CodexTokenUsageBucket {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CodexTokenUsageSummary {
  generatedAt: string;
  timeframes: Record<CodexTokenUsageTimeframe, CodexTokenUsageBucket>;
}

export type CodexAutomationStatus = "ACTIVE" | "PAUSED";

export interface CodexAutomationSummary {
  id: string;
  kind: string;
  name: string;
  prompt: string;
  status: CodexAutomationStatus;
  rrule: string;
  model: string;
  reasoningEffort: string;
  executionEnvironment: string;
  cwds: string[];
  createdAt: number | null;
  updatedAt: number | null;
}

export interface CodexAutomationWriteInput {
  kind: string;
  name: string;
  prompt: string;
  status: CodexAutomationStatus;
  rrule: string;
  model: string;
  reasoningEffort: string;
  executionEnvironment: string;
  cwds: string[];
}

export type CodexReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface CodexMobileModelSettings {
  model: string;
  effort: CodexReasoningEffort;
}

export interface CodexModelOption {
  id: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: CodexReasoningEffort[];
  defaultReasoningEffort: CodexReasoningEffort;
  isDefault: boolean;
}

export interface PluginSuggestion {
  id: string;
  displayName: string;
  invocationName: string;
  kind: "plugin" | "skill";
  pluginName?: string;
  skillName?: string;
  description: string;
  source: string;
  keywords: string[];
}

export interface SkillSelection {
  id: string;
}

export interface CodexCompletionSummary {
  conversationId: string;
  failed: boolean;
  isComplete: boolean;
  latestTurnCompletedAt: string | null;
  latestTurnId: string | null;
  projectId: string;
  projectName?: string;
  prompt: string;
  source: "codex_app";
  status: string;
  updatedAt: string;
  workspaceId: string;
}

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
  cursorPosition?: RemoteControlCursorPosition | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type RemoteControlPermissionState = "unknown" | "granted" | "needed";

export interface RemoteControlCursorPosition {
  x: number;
  y: number;
}

export interface RemoteControlFrame {
  sequence: number;
  capturedAt: string;
  width: number;
  height: number;
  mimeType: "image/jpeg";
  dataBase64: string;
}

export interface RemoteControlTextTarget {
  appName: string;
  isTextInput: boolean;
  role: string;
  roleDescription?: string;
  subrole?: string;
}

export type RemoteControlInputEvent =
  | {
      type: "pointer";
      phase: "down" | "move" | "up" | "scroll";
      x: number;
      y: number;
      buttons?: number;
      clickCount?: number;
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

export interface RemoteControlSignal {
  id: string;
  sessionId: string;
  senderMachineId: string;
  recipientMachineId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
