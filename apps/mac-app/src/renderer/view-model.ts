import type {
  LocalCodexCompletionState,
  LocalCodexConversationSummary,
  LocalCodexMessage,
  LocalCodexProjectSummary
} from "@abitat_reece/host-daemon/local-control";

export type StatusTone = "danger" | "idle" | "running" | "success" | "warning";

const RUNNING_STATUSES = new Set(["awaiting_approval", "queued", "running"]);
const SUCCESS_STATUSES = new Set(["approved", "completed", "pushed"]);
const DANGER_STATUSES = new Set(["cancelled", "failed"]);

export function statusTone(status: string): StatusTone {
  if (RUNNING_STATUSES.has(status)) {
    return "running";
  }
  if (SUCCESS_STATUSES.has(status)) {
    return "success";
  }
  if (DANGER_STATUSES.has(status)) {
    return "danger";
  }
  if (status === "draft" || status === "idle") {
    return "idle";
  }
  return "warning";
}

export function sortProjects(projects: LocalCodexProjectSummary[]) {
  return [...projects].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  );
}

export function sortConversations(conversations: LocalCodexConversationSummary[]) {
  return [...conversations].sort(
    (left, right) => safeTime(right.updatedAt) - safeTime(left.updatedAt)
  );
}

export function activeCompletionCount(states: LocalCodexCompletionState[]) {
  return states.filter((state) => RUNNING_STATUSES.has(String(state.status))).length;
}

export function messagePreview(message: LocalCodexMessage, limit = 120) {
  const compact = message.content.replace(/\s+/gu, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, Math.max(0, limit - 1))}...`;
}

export function formatTokenCount(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function safeTime(value: Date | string | undefined) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
