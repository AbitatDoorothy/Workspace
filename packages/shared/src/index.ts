import { z } from "zod";

export const packageInfo = {
  name: "@abitat/shared",
  phase: "Phase 0"
} as const;

const idSchema = z.string().min(1);
const metadataSchema = z.record(z.string(), z.unknown());
const emptyPayloadSchema = z.object({}).strict().default({});

export const machineTypeSchema = z.enum(["host", "client"]);
export const machineStatusSchema = z.enum(["pending", "online", "offline", "error"]);
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
  activeConversationId: idSchema.optional()
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
  agentId: idSchema,
  type: conversationTypeSchema,
  prompt: z.string().min(1)
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
  machineId: idSchema
});

export const daemonJobAckRequestSchema = z.object({
  status: z.enum(["running", "completed", "failed"]),
  errorMessage: z.string().min(1).optional()
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
    repoUrl: z.string().url(),
    defaultBranch: z.string().min(1)
  })
});

export const startConversationJobSchema = daemonJobBaseSchema.extend({
  type: z.literal("start_conversation"),
  conversationId: idSchema,
  payload: z.object({
    repoUrl: z.string().url(),
    defaultBranch: z.string().min(1),
    agentRuntime: runtimeSchema,
    model: z.string().min(1),
    instructions: z.string().min(1),
    prompt: z.string().min(1),
    allowedTools: z.array(z.string().min(1)).default([])
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
    commitMessage: z.string().trim().min(1)
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
  collectChangesetJobSchema,
  commitAndPushJobSchema,
  createPrJobSchema,
  cancelConversationJobSchema
]);

export const daemonJobPollResponseSchema = z.object({
  job: daemonJobSchema.nullable()
});

export type MachineType = z.infer<typeof machineTypeSchema>;
export type MachineStatus = z.infer<typeof machineStatusSchema>;
export type Runtime = z.infer<typeof runtimeSchema>;
export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export type RunEventType = z.infer<typeof runEventTypeSchema>;
export type DaemonJobType = z.infer<typeof daemonJobTypeSchema>;
export type ToolName = z.infer<typeof toolNameSchema>;
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
