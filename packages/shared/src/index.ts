import { z } from "zod";

export const packageInfo = {
  name: "@abitat/shared",
  phase: "Phase 0"
} as const;

const idSchema = z.string().min(1);
const metadataSchema = z.record(z.string(), z.unknown());
const emptyPayloadSchema = z.object({}).strict().default({});
const repoUrlSchema = z.string().min(1);

export const machineTypeSchema = z.enum(["host", "client"]);
export const machineStatusSchema = z.enum(["pending", "online", "offline", "error"]);
export const deviceKindSchema = z.enum(["host", "phone", "browser", "tablet"]);
export const runtimeSchema = z.enum(["codex", "claude", "mock"]);
export const conversationTypeSchema = z.enum(["feature", "bugfix", "investigation", "refactor"]);
export const conversationStatusSchema = z.enum([
  "draft",
  "queued",
  "preparing",
  "running",
  "awaiting_approval",
  "approved",
  "committing",
  "pushed",
  "failed",
  "cancelled"
]);
export const runEventTypeSchema = z.enum([
  "status",
  "stdout",
  "stderr",
  "tool_scan",
  "git",
  "diff",
  "test",
  "summary",
  "approval",
  "error"
]);
export const daemonJobTypeSchema = z.enum([
  "scan_tools",
  "clone_repo",
  "start_conversation",
  "summarize_conversation",
  "collect_changeset",
  "commit_and_push",
  "create_pr",
  "cancel_conversation"
]);
export const toolNameSchema = z.enum(["git", "gh", "codex", "claude", "node", "python"]);

export const hostPairingRequestSchema = z.object({
  pairingCode: z.string().min(1),
  machineName: z.string().min(1),
  daemonVersion: z.string().min(1)
});

export const hostPairingResponseSchema = z.object({
  machineId: idSchema,
  workspaceId: idSchema,
  hostToken: z.string().min(1)
});

export const hostHeartbeatRequestSchema = z.object({
  machineId: idSchema,
  status: machineStatusSchema,
  activeConversationId: idSchema.optional(),
  activeConversationIds: z.array(idSchema).optional()
});

export const hostHeartbeatResponseSchema = z.object({
  ok: z.literal(true),
  serverTime: z.string().datetime()
});

export const hostToolSchema = z.object({
  name: toolNameSchema,
  installed: z.boolean(),
  version: z.string().min(1).optional(),
  path: z.string().min(1).optional()
});

export const toolScanUploadRequestSchema = z.object({
  machineId: idSchema,
  tools: z.array(hostToolSchema).min(1)
});

export const okResponseSchema = z.object({
  ok: z.literal(true)
});

export const conversationCreateRequestSchema = z.object({
  workspaceId: idSchema,
  projectId: idSchema,
  agentId: idSchema.optional(),
  runtime: runtimeSchema.default("codex"),
  type: conversationTypeSchema.default("investigation"),
  prompt: z.string().default("")
});

export const conversationCreateResponseSchema = z.object({
  conversationId: idSchema,
  status: z.literal("queued")
});

export const runEventIngestRequestSchema = z.object({
  sequence: z.number().int().positive(),
  type: runEventTypeSchema,
  content: z.string(),
  metadata: metadataSchema.default({})
});

export const approvalRequestSchema = z.object({
  approvalType: z.literal("commit_and_push"),
  commitMessage: z.string().trim().min(1)
});

export const approvalResponseSchema = z.object({
  ok: z.literal(true),
  status: z.literal("approved")
});

export const daemonJobPollRequestSchema = z.object({
  machineId: idSchema,
  activeConversationId: idSchema.optional(),
  activeConversationIds: z.array(idSchema).optional()
});

export const daemonJobAckRequestSchema = z.object({
  status: z.enum(["running", "completed", "failed"]),
  errorMessage: z.string().min(1).optional(),
  branchName: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
  runtimeSessionId: z.string().min(1).optional(),
  commitSha: z.string().min(1).optional(),
  prUrl: z.string().url().optional()
});

const daemonJobBaseSchema = z.object({
  id: idSchema
});

export const scanToolsJobSchema = daemonJobBaseSchema.extend({
  type: z.literal("scan_tools"),
  payload: emptyPayloadSchema
});

export const cloneRepoJobSchema = daemonJobBaseSchema.extend({
  type: z.literal("clone_repo"),
  projectId: idSchema,
  payload: z.object({
    repoUrl: repoUrlSchema,
    defaultBranch: z.string().min(1)
  })
});

const conversationRuntimeJobPayloadSchema = z.object({
  repoUrl: repoUrlSchema,
  conversationType: conversationTypeSchema,
  agentRuntime: runtimeSchema,
  model: z.string().min(1).optional(),
  instructions: z.string().min(1),
  prompt: z.string(),
  allowedTools: z.array(z.string().min(1)).default([]),
  resumeSessionId: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
  branchName: z.string().min(1).optional(),
  hostLocalPath: z.string().min(1).optional(),
  presentation: z.enum(["terminal", "inline", "remote_chat"]).default("terminal"),
  taskTitle: z.string().optional()
});

export const startConversationJobSchema = daemonJobBaseSchema.extend({
  type: z.literal("start_conversation"),
  conversationId: idSchema,
  payload: conversationRuntimeJobPayloadSchema
});

export const summarizeConversationJobSchema = daemonJobBaseSchema.extend({
  type: z.literal("summarize_conversation"),
  conversationId: idSchema,
  payload: conversationRuntimeJobPayloadSchema.extend({
    presentation: z.literal("inline")
  })
});

export const collectChangesetJobSchema = daemonJobBaseSchema.extend({
  type: z.literal("collect_changeset"),
  conversationId: idSchema,
  payload: emptyPayloadSchema
});

export const commitAndPushJobSchema = daemonJobBaseSchema.extend({
  type: z.literal("commit_and_push"),
  conversationId: idSchema,
  payload: z.object({
    commitMessage: z.string().trim().min(1),
    branchName: z.string().min(1),
    worktreePath: z.string().min(1)
  })
});

export const createPrJobSchema = daemonJobBaseSchema.extend({
  type: z.literal("create_pr"),
  conversationId: idSchema,
  payload: z.object({
    title: z.string().min(1),
    body: z.string().optional()
  })
});

export const cancelConversationJobSchema = daemonJobBaseSchema.extend({
  type: z.literal("cancel_conversation"),
  conversationId: idSchema,
  payload: emptyPayloadSchema
});

export const daemonJobSchema = z.discriminatedUnion("type", [
  scanToolsJobSchema,
  cloneRepoJobSchema,
  startConversationJobSchema,
  summarizeConversationJobSchema,
  collectChangesetJobSchema,
  commitAndPushJobSchema,
  createPrJobSchema,
  cancelConversationJobSchema
]);

export const daemonJobPollResponseSchema = z.object({
  job: daemonJobSchema.nullable()
});

export const phonePairingStartRequestSchema = z.object({
  workspaceId: idSchema,
  hostMachineId: idSchema
});

export const phonePairingStartResponseSchema = z.object({
  pairingId: idSchema,
  code: z.string().min(1),
  expiresAt: z.string().datetime(),
  qrPayload: z.string().min(1)
});

export const phonePairingCompleteRequestSchema = z.object({
  code: z.string().min(1),
  deviceName: z.string().min(1),
  platform: z.literal("ios"),
  appVersion: z.string().min(1),
  publicKey: z.string().min(1).optional()
});

export const phonePairingCompleteResponseSchema = z.object({
  machineId: idSchema,
  workspaceId: idSchema,
  hostMachineId: idSchema,
  clientToken: z.string().min(1)
});

export const mobileDeviceSummarySchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  status: machineStatusSchema
});

export const mobileWorkspaceSummarySchema = z.object({
  id: idSchema,
  name: z.string().min(1)
});

export const mobileBootstrapResponseSchema = z.object({
  workspace: mobileWorkspaceSummarySchema,
  phone: mobileDeviceSummarySchema,
  host: mobileDeviceSummarySchema.nullable()
});

export const conversationMessageRoleSchema = z.enum(["user", "assistant", "system", "runtime"]);

export const conversationMessageCreateRequestSchema = z.object({
  content: z.string().min(1),
  role: conversationMessageRoleSchema.default("user"),
  sourceDeviceId: idSchema.optional(),
  clientMessageId: z.string().min(1).optional(),
  metadata: metadataSchema.default({})
});

export const conversationMessageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  sequence: z.number().int().positive(),
  role: conversationMessageRoleSchema,
  sourceDeviceId: idSchema.nullable().optional(),
  content: z.string(),
  metadata: metadataSchema.default({}),
  createdAt: z.string().datetime()
});

export const remoteControlStatusSchema = z.enum([
  "requested",
  "connecting",
  "active",
  "ended",
  "failed"
]);

export const remoteControlSessionCreateRequestSchema = z.object({
  hostMachineId: idSchema,
  screenEnabled: z.boolean().default(true),
  inputEnabled: z.boolean().default(true)
});

export const remoteControlSessionResponseSchema = z.object({
  id: idSchema,
  status: remoteControlStatusSchema,
  hostMachineId: idSchema,
  clientMachineId: idSchema,
  screenEnabled: z.boolean(),
  inputEnabled: z.boolean(),
  errorMessage: z.string().nullable().optional()
});

export const remoteControlSignalTypeSchema = z.enum([
  "offer",
  "answer",
  "ice_candidate",
  "frame",
  "input",
  "status"
]);

export const remoteControlSignalSchema = z.object({
  sessionId: idSchema,
  senderMachineId: idSchema,
  recipientMachineId: idSchema.optional(),
  type: remoteControlSignalTypeSchema,
  payload: metadataSchema
});

const remoteInputModifierSchema = z.enum(["cmd", "ctrl", "alt", "shift"]);

export const remotePointerInputEventSchema = z.object({
  type: z.literal("pointer"),
  phase: z.enum(["down", "move", "up", "scroll"]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  buttons: z.number().int().nonnegative().optional(),
  dx: z.number().optional(),
  dy: z.number().optional()
});

export const remoteTextInputEventSchema = z.object({
  type: z.literal("text"),
  value: z.string()
});

export const remoteKeyInputEventSchema = z.object({
  type: z.literal("key"),
  key: z.string().min(1),
  code: z.string().min(1).optional(),
  modifiers: z.array(remoteInputModifierSchema).default([])
});

export const remoteInputEventSchema = z.discriminatedUnion("type", [
  remotePointerInputEventSchema,
  remoteTextInputEventSchema,
  remoteKeyInputEventSchema
]);

export type MachineType = z.infer<typeof machineTypeSchema>;
export type MachineStatus = z.infer<typeof machineStatusSchema>;
export type DeviceKind = z.infer<typeof deviceKindSchema>;
export type Runtime = z.infer<typeof runtimeSchema>;
export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export type RunEventType = z.infer<typeof runEventTypeSchema>;
export type DaemonJobType = z.infer<typeof daemonJobTypeSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
export type PhonePairingStartRequest = z.infer<typeof phonePairingStartRequestSchema>;
export type PhonePairingStartResponse = z.infer<typeof phonePairingStartResponseSchema>;
export type PhonePairingCompleteRequest = z.infer<typeof phonePairingCompleteRequestSchema>;
export type PhonePairingCompleteResponse = z.infer<typeof phonePairingCompleteResponseSchema>;
export type MobileBootstrapResponse = z.infer<typeof mobileBootstrapResponseSchema>;
export type ConversationMessageRole = z.infer<typeof conversationMessageRoleSchema>;
export type ConversationMessageCreateRequest = z.infer<
  typeof conversationMessageCreateRequestSchema
>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type RemoteControlStatus = z.infer<typeof remoteControlStatusSchema>;
export type RemoteControlSessionCreateRequest = z.infer<
  typeof remoteControlSessionCreateRequestSchema
>;
export type RemoteControlSessionResponse = z.infer<typeof remoteControlSessionResponseSchema>;
export type RemoteControlSignal = z.infer<typeof remoteControlSignalSchema>;
export type RemoteInputEvent = z.infer<typeof remoteInputEventSchema>;
export type HostPairingRequest = z.infer<typeof hostPairingRequestSchema>;
export type HostPairingResponse = z.infer<typeof hostPairingResponseSchema>;
export type HostHeartbeatRequest = z.infer<typeof hostHeartbeatRequestSchema>;
export type HostHeartbeatResponse = z.infer<typeof hostHeartbeatResponseSchema>;
export type HostTool = z.infer<typeof hostToolSchema>;
export type ToolScanUploadRequest = z.infer<typeof toolScanUploadRequestSchema>;
export type ConversationCreateRequest = z.infer<typeof conversationCreateRequestSchema>;
export type ConversationCreateResponse = z.infer<typeof conversationCreateResponseSchema>;
export type RunEventIngestRequest = z.infer<typeof runEventIngestRequestSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;
export type DaemonJobPollRequest = z.infer<typeof daemonJobPollRequestSchema>;
export type DaemonJobAckRequest = z.infer<typeof daemonJobAckRequestSchema>;
export type DaemonJob = z.infer<typeof daemonJobSchema>;
export type DaemonJobPollResponse = z.infer<typeof daemonJobPollResponseSchema>;
