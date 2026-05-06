import type { ConversationStatus, ConversationType } from "@abitat/shared";

export type ConversationLabel = "in_process" | "complete";
export const conversationDragMimeType = "application/x-abitat-conversation";

export interface ConversationBoardConversation {
  id: string;
  type: ConversationType;
  status: ConversationStatus;
  prompt: string;
  branchName?: string | null;
  codexDeepLink?: string | null;
  runtimeSessionId?: string | null;
  source?: "abitat" | "codex_app";
  worktreePath?: string | null;
}

interface ConversationLabelRequestInput {
  conversationId: string;
  redirectTo: string;
  userId: string;
}

interface ConversationDragPayload {
  conversationId: string;
  sourceLabel: ConversationLabel;
}

export function conversationDropTarget(
  sourceLabel: ConversationLabel,
  targetLabel: ConversationLabel
) {
  return sourceLabel === targetLabel ? null : targetLabel;
}

export function conversationLabelFromStatus(status: string): ConversationLabel {
  return status === "pushed" ? "complete" : "in_process";
}

export function conversationLabelText(status: string) {
  return conversationLabelFromStatus(status) === "complete" ? "Complete" : "In process";
}

export function conversationStatusForLabel(label: ConversationLabel): ConversationStatus {
  return label === "complete" ? "pushed" : "running";
}

export function canOpenConversationSummary(status: string) {
  return conversationLabelFromStatus(status) === "complete";
}

export function conversationTitle(prompt: string) {
  return prompt.trim() || "Untitled conversation";
}

export function canStartConversationCardDrag(tagName: string) {
  return !new Set(["A", "BUTTON", "INPUT", "LABEL", "SELECT", "TEXTAREA"]).has(
    tagName.toUpperCase()
  );
}

export function canManageConversationCard(
  conversation: Pick<ConversationBoardConversation, "source">
) {
  return conversation.source !== "codex_app";
}

export function conversationCodexAppHref(
  conversation: Pick<ConversationBoardConversation, "codexDeepLink" | "runtimeSessionId">
) {
  if (conversation.codexDeepLink) {
    return conversation.codexDeepLink;
  }

  return conversation.runtimeSessionId
    ? `codex://local/${encodeURIComponent(conversation.runtimeSessionId)}`
    : null;
}

export function createConversationDragPayload(payload: ConversationDragPayload) {
  return JSON.stringify(payload);
}

export function parseConversationDragPayload(value: string): ConversationDragPayload | null {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!isRecord(parsed)) {
      return null;
    }

    const conversationId = parsed.conversationId;
    const sourceLabel = parsed.sourceLabel;

    if (
      typeof conversationId !== "string" ||
      conversationId.length === 0 ||
      (sourceLabel !== "in_process" && sourceLabel !== "complete")
    ) {
      return null;
    }

    return { conversationId, sourceLabel };
  } catch {
    return null;
  }
}

export function createConversationLabelRequest({
  conversationId,
  label,
  redirectTo,
  userId
}: ConversationLabelRequestInput & { label: ConversationLabel }) {
  return {
    body: JSON.stringify({ label, redirectTo, userId }),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: `/api/conversations/${conversationId}/label`
  };
}

export function createConversationDeleteRequest({
  conversationId,
  redirectTo,
  userId
}: ConversationLabelRequestInput) {
  return {
    body: JSON.stringify({ redirectTo, userId }),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: `/api/conversations/${conversationId}/delete`
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
