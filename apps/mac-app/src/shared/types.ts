import type {
  LocalCodexCompletionState,
  LocalCodexConversationSummary,
  LocalCodexMessage,
  LocalCodexProjectSummary,
  LocalGeneratedFileDownload,
  LocalGeneratedFileSummary,
  CodexAutomationSummary,
  CodexAutomationWriteInput
} from "@abitat_reece/host-daemon/local-control";
import type { CodexMobileModelSettings, CodexModelOption } from "@abitat_reece/shared";

export interface DesktopRuntimeStatus {
  codex: {
    available: boolean;
    error?: string;
  };
  diagnosticsLogPath: string;
  endpoint: string;
  localEndpoint: string;
  macId: string;
  macName: string;
  relayConnected: boolean;
  relayEndpoint: string;
  relayId?: string;
  serverStartedAt: string;
  transport: "relay";
}

export interface DesktopTokenUsageBucket {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface DesktopTokenUsageSummary {
  generatedAt: string;
  timeframes: {
    "1d": DesktopTokenUsageBucket;
    "7d": DesktopTokenUsageBucket;
    all: DesktopTokenUsageBucket;
  };
}

export interface DesktopPairingPayload {
  expiresAt: string;
  manualCode: string;
  payloadJson: string;
  qrDataUrl: string;
  relayId?: string;
}

export interface DesktopDiagnosticsLog {
  data: string;
  logPath: string;
  size: number;
  truncated: boolean;
}

export interface DesktopApi {
  continueConversation(
    conversationId: string,
    input: {
      attachments?: Array<{ kind: "file" | "image"; name: string; path: string }>;
      clientMessageId?: string;
      delivery?: "queue" | "steer";
      modelSettings?: CodexMobileModelSettings;
      prompt: string;
    }
  ): Promise<{ conversationId: string; status: string }>;
  createAutomation(input: CodexAutomationWriteInput): Promise<CodexAutomationSummary>;
  createPhonePairing(): Promise<DesktopPairingPayload>;
  downloadGeneratedFile(
    conversationId: string,
    fileId: string
  ): Promise<LocalGeneratedFileDownload>;
  getDiagnosticsLog(): Promise<DesktopDiagnosticsLog>;
  getStatus(): Promise<DesktopRuntimeStatus>;
  getTokenUsage(): Promise<DesktopTokenUsageSummary>;
  listAutomations(): Promise<CodexAutomationSummary[]>;
  listCompletionStates(): Promise<LocalCodexCompletionState[]>;
  listConversations(projectId: string): Promise<LocalCodexConversationSummary[]>;
  listGeneratedFiles(conversationId: string): Promise<LocalGeneratedFileSummary[]>;
  listMessages(
    conversationId: string,
    options?: { afterSequence?: number; forceRefresh?: boolean; includeRuntime?: boolean }
  ): Promise<LocalCodexMessage[]>;
  listModelOptions(): Promise<CodexModelOption[]>;
  listProjects(): Promise<LocalCodexProjectSummary[]>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  startConversation(
    projectId: string,
    input: {
      attachments?: Array<{ kind: "file" | "image"; name: string; path: string }>;
      modelSettings?: CodexMobileModelSettings;
      prompt: string;
    }
  ): Promise<{ conversationId: string; status: string }>;
  updateAutomation(
    automationId: string,
    input: Partial<CodexAutomationWriteInput>
  ): Promise<CodexAutomationSummary>;
}

declare global {
  interface Window {
    abitat: DesktopApi;
  }
}
