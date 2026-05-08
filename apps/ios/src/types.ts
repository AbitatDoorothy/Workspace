export type RouteName =
  | "pairing"
  | "workspace"
  | "projects"
  | "project"
  | "conversation"
  | "settings";

export interface PairingState {
  apiUrl: string;
  clientToken: string;
  hostMachineId: string;
  machineId: string;
  workspaceId: string;
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
  errorMessage?: string | null;
}

export interface RemoteControlSignal {
  id: string;
  sessionId: string;
  senderMachineId: string;
  recipientMachineId?: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
