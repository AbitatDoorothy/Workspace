"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "../../components/app-shell";
import {
  canStartConversationCardDrag,
  canManageConversationCard,
  canOpenConversationSummary,
  conversationCodexAppHref,
  conversationDragMimeType,
  conversationDropTarget,
  conversationLabelFromStatus,
  conversationLabelText,
  conversationStatusForLabel,
  conversationTitle,
  createConversationDragPayload,
  createConversationLabelRequest,
  parseConversationDragPayload,
  type ConversationBoardConversation,
  type ConversationLabel
} from "../conversation-board-model";

interface ConversationBoardProps {
  conversations: ConversationBoardConversation[];
  projectId: string;
  userId?: string;
}

const columns: Array<{ label: string; value: ConversationLabel }> = [
  { label: "In process", value: "in_process" },
  { label: "Complete", value: "complete" }
];

interface ActiveDragPayload {
  conversationId: string;
  sourceLabel: ConversationLabel;
}

export function ConversationBoard({
  conversations,
  projectId,
  userId = "user_demo"
}: ConversationBoardProps) {
  const router = useRouter();
  const [items, setItems] = useState(conversations);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ConversationLabel | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeDrag = useRef<ActiveDragPayload | null>(null);

  useEffect(() => {
    setItems(conversations);
  }, [conversations]);

  const conversationsByLabel = useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        conversations: items.filter(
          (conversation) => conversationLabelFromStatus(conversation.status) === column.value
        )
      })),
    [items]
  );

  function handleDragStart(
    event: ReactDragEvent<HTMLElement>,
    conversation: ConversationBoardConversation
  ) {
    if (
      !canManageConversationCard(conversation) ||
      !canStartDragFromTarget(event.target) ||
      pendingId === conversation.id
    ) {
      event.preventDefault();
      return;
    }

    const payload: ActiveDragPayload = {
      conversationId: conversation.id,
      sourceLabel: conversationLabelFromStatus(conversation.status)
    };

    window.getSelection()?.removeAllRanges();
    activeDrag.current = payload;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(conversationDragMimeType, createConversationDragPayload(payload));
    event.dataTransfer.setData("text/plain", conversation.id);
    setError(null);
    setDraggingId(conversation.id);
    document.body.classList.add("conversation-board-is-dragging");
  }

  function handleColumnDragOver(
    event: ReactDragEvent<HTMLElement>,
    targetLabel: ConversationLabel
  ) {
    if (!hasConversationDragData(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(targetLabel);
  }

  function handleColumnDragLeave(event: ReactDragEvent<HTMLElement>) {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setDropTarget(null);
  }

  function handleColumnDrop(event: ReactDragEvent<HTMLElement>, targetLabel: ConversationLabel) {
    if (!hasConversationDragData(event)) {
      return;
    }

    event.preventDefault();
    const payload = getConversationDragPayload(event.dataTransfer);
    stopTrackingNativeDrag();

    if (!payload) {
      return;
    }

    const nextLabel = conversationDropTarget(payload.sourceLabel, targetLabel);
    const conversation = items.find((item) => item.id === payload.conversationId);

    if (!conversation || !canManageConversationCard(conversation) || nextLabel === null) {
      return;
    }

    void moveConversation(conversation, nextLabel);
  }

  function handleDragEnd() {
    stopTrackingNativeDrag();
  }

  function hasConversationDragData(event: ReactDragEvent<HTMLElement>) {
    return (
      activeDrag.current !== null ||
      Array.from(event.dataTransfer.types).includes(conversationDragMimeType)
    );
  }

  function getConversationDragPayload(dataTransfer: DataTransfer) {
    const payload = parseConversationDragPayload(dataTransfer.getData(conversationDragMimeType));

    if (payload) {
      return payload;
    }

    const fallbackConversationId = dataTransfer.getData("text/plain");
    const activePayload = activeDrag.current;

    return activePayload?.conversationId === fallbackConversationId ? activePayload : null;
  }

  function stopTrackingNativeDrag() {
    activeDrag.current = null;
    setDraggingId(null);
    setDropTarget(null);
    document.body.classList.remove("conversation-board-is-dragging");
  }

  async function moveConversation(
    conversation: ConversationBoardConversation,
    nextLabel: ConversationLabel
  ) {
    const previousItems = items;
    setPendingId(conversation.id);
    setError(null);
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === conversation.id
          ? { ...item, status: conversationStatusForLabel(nextLabel) }
          : item
      )
    );

    try {
      const request = createConversationLabelRequest({
        conversationId: conversation.id,
        label: nextLabel,
        redirectTo: `/projects/${projectId}`,
        userId
      });
      const response = await fetch(request.url, {
        body: request.body,
        headers: request.headers,
        method: request.method
      });

      if (!response.ok) {
        throw new Error("Unable to update conversation label");
      }

      router.refresh();
    } catch {
      setItems(previousItems);
      setError("Unable to move conversation. Try updating the label again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="conversation-board" aria-label="Conversations by label">
      {error ? (
        <p className="conversation-board-error" role="alert">
          {error}
        </p>
      ) : null}
      {conversationsByLabel.map((column) => (
        <div
          className={`conversation-column ${
            dropTarget === column.value ? "conversation-column-drop-target" : ""
          }`}
          data-conversation-column={column.value}
          key={column.value}
          onDragEnter={(event) => handleColumnDragOver(event, column.value)}
          onDragLeave={handleColumnDragLeave}
          onDragOver={(event) => handleColumnDragOver(event, column.value)}
          onDrop={(event) => handleColumnDrop(event, column.value)}
        >
          <div className="section-heading">
            <h2>{column.label}</h2>
            <span className="muted">{column.conversations.length}</span>
          </div>
          <div className="conversation-card-list">
            {column.conversations.length > 0 ? (
              column.conversations.map((conversation) => {
                const canManage = canManageConversationCard(conversation);
                const codexHref = conversationCodexAppHref(conversation);

                return (
                  <article
                    aria-busy={pendingId === conversation.id}
                    aria-grabbed={draggingId === conversation.id}
                    className={`conversation-card ${
                      draggingId === conversation.id ? "conversation-card-dragging" : ""
                    } ${pendingId === conversation.id ? "conversation-card-pending" : ""}`}
                    draggable={canManage && pendingId !== conversation.id}
                    key={conversation.id}
                    onDragEnd={handleDragEnd}
                    onDragStart={(event) => handleDragStart(event, conversation)}
                  >
                    <div className="conversation-card-head">
                      <span className="avatar-disc">
                        <Icon filled>smart_toy</Icon>
                      </span>
                      <div>
                        <h3>{conversationTitle(conversation.prompt)}</h3>
                        <div className="conversation-card-meta">
                          <span>{conversation.type}</span>
                          <span>
                            {conversation.source === "codex_app"
                              ? "Synced from Codex app"
                              : conversationLabelText(conversation.status)}
                          </span>
                        </div>
                      </div>
                      {canManage ? (
                        <span
                          className="drag-handle"
                          draggable={pendingId !== conversation.id}
                          title="Drag to move conversation"
                        >
                          <Icon>drag_indicator</Icon>
                        </span>
                      ) : null}
                    </div>

                    <div className="conversation-card-actions">
                      {codexHref ? (
                        <a className="ghost-button" href={codexHref}>
                          <Icon>open_in_new</Icon>
                          Open Codex
                        </a>
                      ) : (
                        <button className="ghost-button" disabled type="button">
                          <Icon>open_in_new</Icon>
                          Open Codex
                        </button>
                      )}
                      {canOpenConversationSummary(conversation.status) ||
                      conversation.source === "codex_app" ? (
                        <a
                          className="ghost-button"
                          href={`/projects/${projectId}/conversations/${conversation.id}`}
                        >
                          <Icon>article</Icon>
                          {conversation.source === "codex_app" ? "History" : "Summary"}
                        </a>
                      ) : (
                        <button className="ghost-button" disabled type="button">
                          <Icon>article</Icon>
                          Summary
                        </button>
                      )}
                      {canManage ? (
                        <form
                          action={`/api/conversations/${conversation.id}/delete`}
                          method="post"
                          onSubmit={() => {
                            setPendingId(conversation.id);
                            setError(null);
                          }}
                        >
                          <input type="hidden" name="userId" value={userId} />
                          <input type="hidden" name="redirectTo" value={`/projects/${projectId}`} />
                          <button
                            className="danger-button"
                            disabled={pendingId === conversation.id}
                            type="submit"
                          >
                            <Icon>delete</Icon>
                            Delete
                          </button>
                        </form>
                      ) : null}
                    </div>

                    {canManage ? (
                      <form
                        action={`/api/conversations/${conversation.id}/label`}
                        className="conversation-label-form"
                        key={conversation.status}
                        method="post"
                      >
                        <input type="hidden" name="userId" value={userId} />
                        <input type="hidden" name="redirectTo" value={`/projects/${projectId}`} />
                        <label>
                          Label
                          <select
                            name="label"
                            defaultValue={conversationLabelFromStatus(conversation.status)}
                          >
                            <option value="in_process">In process</option>
                            <option value="complete">Complete</option>
                          </select>
                        </label>
                        <button type="submit">Update</button>
                      </form>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <article className="conversation-empty-card">
                <Icon>add_comment</Icon>
                <p>No {column.label.toLowerCase()} conversations.</p>
              </article>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function canStartDragFromTarget(target: EventTarget) {
  return (
    target instanceof HTMLElement &&
    canStartConversationCardDrag(target.tagName) &&
    target.closest("a,button,input,label,select,textarea") === null
  );
}
