import { useEffect, useMemo, useRef, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import type { ApiClient } from "../api/client";
import { CodexModelControls } from "../components/CodexModelControls";
import { Button, StatusPill } from "../components/Controls";
import { rememberRunningConversation } from "../notifications/thread-completion-notifications";
import { FixedScreen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type {
  CodexMobileModelSettings,
  ConversationAttachment,
  ConversationMessage,
  ConversationSummary
} from "../types";

interface ConversationScreenProps {
  api: ApiClient;
  conversation: ConversationSummary;
  modelSettings: CodexMobileModelSettings;
  onBack(): void;
  onModelSettingsChange(next: CodexMobileModelSettings): void;
}

interface PendingAttachment {
  id: string;
  dataBase64?: string;
  mimeType: string;
  name: string;
  uri: string;
}

interface SendConversationInput {
  attachments?: PendingAttachment[];
  prompt: string;
}

const MESSAGE_POLL_INTERVAL_MS = 1800;
const STATUS_POLL_INTERVAL_MS = 2500;
const FULL_MESSAGE_REFRESH_INTERVAL_MS = 12000;

export function ConversationScreen({
  api,
  conversation,
  modelSettings,
  onBack,
  onModelSettingsChange
}: ConversationScreenProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [status, setStatus] = useState(conversation.status);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const [showScrollToLatestButton, setShowScrollToLatestButton] = useState(false);
  const listRef = useRef<FlatList<ConversationMessage> | null>(null);
  const newestFirstMessages = useMemo(
    () => visibleConversationMessages(messages).reverse(),
    [messages]
  );
  const lastSequence = useMemo(
    () => messages.reduce((max, message) => Math.max(max, message.sequence), 0),
    [messages]
  );
  const latestMessageId = messages.length > 0 ? messages[messages.length - 1]?.id : "";
  const pendingAutoScrollRef = useRef(true);
  const latestSequenceRef = useRef(0);
  const latestConversationUpdatedAtRef = useRef<string | null>(conversation.updatedAt ?? null);
  const latestStatusRef = useRef(conversation.status);
  const lastFullMessageRefreshAtRef = useRef(0);
  const messageRefreshInFlightRef = useRef(false);
  const pendingFullMessageRefreshRef = useRef(false);
  const sendingCountRef = useRef(0);
  const canSendNow = canAcceptConversationInput(status) && !isSending;

  function scrollToLatest(animated = true) {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ animated, offset: 0 });
    });
    pendingAutoScrollRef.current = false;
  }

  function handleMessagesContentSizeChange() {
    if (pendingAutoScrollRef.current) {
      scrollToLatest(true);
    }
  }

  function handleMessagesScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromLatest = contentOffset.y;
    setShowScrollToLatestButton(distanceFromLatest > 96);
  }

  useEffect(() => {
    latestSequenceRef.current = lastSequence;
  }, [lastSequence]);

  useEffect(() => {
    setError(null);
    setMessages([]);
    setPrompt("");
    setAttachments([]);
    setStatus(conversation.status);
    setIsHeaderExpanded(false);
    pendingAutoScrollRef.current = true;
    latestSequenceRef.current = 0;
    latestConversationUpdatedAtRef.current = conversation.updatedAt ?? null;
    latestStatusRef.current = conversation.status;
    lastFullMessageRefreshAtRef.current = 0;
    messageRefreshInFlightRef.current = false;
    pendingFullMessageRefreshRef.current = false;
  }, [conversation]);

  useEffect(() => {
    let cancelled = false;

    async function refreshMessages(afterSequence?: number) {
      const isFullRefresh = typeof afterSequence !== "number";
      if (messageRefreshInFlightRef.current) {
        if (isFullRefresh) {
          pendingFullMessageRefreshRef.current = true;
        }
        return;
      }

      messageRefreshInFlightRef.current = true;
      try {
        const nextMessages = await api.listMessages(conversation.id, afterSequence, {
          includeRuntime: false
        });
        if (!cancelled) {
          if (isFullRefresh) {
            lastFullMessageRefreshAtRef.current = Date.now();
          }
          setError(null);
          setMessages((current) => mergeConversationMessages(current, nextMessages));
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to load messages");
        }
      } finally {
        messageRefreshInFlightRef.current = false;
        if (!cancelled && pendingFullMessageRefreshRef.current) {
          pendingFullMessageRefreshRef.current = false;
          void refreshMessages();
        }
      }
    }

    function refreshMessagesForPoll() {
      const shouldFullRefresh =
        Date.now() - lastFullMessageRefreshAtRef.current >= FULL_MESSAGE_REFRESH_INTERVAL_MS;

      void refreshMessages(shouldFullRefresh ? undefined : latestSequenceRef.current);
    }

    async function refreshStatus() {
      try {
        const latestConversations = await api.listConversations(conversation.projectId);
        const latestConversation = latestConversations.find(
          (candidate) => candidate.id === conversation.id
        );
        if (!cancelled) {
          const nextStatus = latestConversation?.status ?? conversation.status;
          const nextUpdatedAt = latestConversation?.updatedAt ?? null;
          const previousStatus = latestStatusRef.current;
          const previousUpdatedAt = latestConversationUpdatedAtRef.current;

          latestStatusRef.current = nextStatus;
          latestConversationUpdatedAtRef.current = nextUpdatedAt;
          setStatus(nextStatus);

          if (
            shouldForceMessageRefreshAfterStatusPoll({
              nextStatus,
              nextUpdatedAt,
              previousStatus,
              previousUpdatedAt
            })
          ) {
            void refreshMessages();
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to refresh Codex status");
        }
      }
    }

    void refreshMessages();
    void refreshStatus();
    const messageTimer = setInterval(refreshMessagesForPoll, MESSAGE_POLL_INTERVAL_MS);
    const statusTimer = setInterval(refreshStatus, STATUS_POLL_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshMessages();
        void refreshStatus();
      }
    });

    return () => {
      cancelled = true;
      clearInterval(messageTimer);
      clearInterval(statusTimer);
      appStateSubscription.remove();
    };
  }, [api, conversation.id, conversation.projectId, conversation.status]);

  useEffect(() => {
    pendingAutoScrollRef.current = true;
    const timer = setTimeout(() => scrollToLatest(true), 50);

    return () => {
      clearTimeout(timer);
    };
  }, [latestMessageId]);

  async function sendConversation(input: SendConversationInput) {
    const queuedAttachments = input.attachments ?? [];
    const submittedPrompt = promptForSend(input.prompt, queuedAttachments);
    const clientMessageId = `ios-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const afterSequence = lastSequence;
    const optimisticMessage = createOptimisticMessage({
      attachmentNames: queuedAttachments.map((attachment) => attachment.name),
      clientMessageId,
      conversationId: conversation.id,
      createdAt: new Date().toISOString(),
      prompt: submittedPrompt,
      sequence: afterSequence + 1
    });

    setError(null);
    setMessages((current) => mergeConversationMessages(current, [optimisticMessage]));
    pendingAutoScrollRef.current = true;

    sendingCountRef.current += 1;
    setIsSending(true);
    try {
      const uploadedAttachments = await Promise.all(
        queuedAttachments.map((attachment) => uploadAttachment(api, attachment))
      );
      const continued = await api.continueConversation(conversation.id, {
        attachments: uploadedAttachments.map((attachment) => ({
          kind: attachment.kind,
          name: attachment.name,
          path: attachment.path
        })),
        clientMessageId,
        effort: modelSettings.effort,
        model: modelSettings.model,
        prompt: submittedPrompt
      });
      setStatus(continued.status);
      rememberRunningConversation(conversation.id);
      setMessages((current) => markLocalMessageSent(current, clientMessageId));
      try {
        const next = await api.listMessages(conversation.id, afterSequence, {
          includeRuntime: false
        });
        setMessages((current) => mergeConversationMessages(current, next));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to refresh Codex messages");
      }
    } catch (caught) {
      setMessages((current) => markLocalMessageFailed(current, clientMessageId));
      setError(caught instanceof Error ? caught.message : "Unable to continue Codex");
    } finally {
      sendingCountRef.current = Math.max(0, sendingCountRef.current - 1);
      setIsSending(sendingCountRef.current > 0);
    }
  }

  function continueConversation() {
    const queuedPrompt = prompt;
    const queuedAttachments = attachments;

    if (!canSendPrompt(queuedPrompt, queuedAttachments) || !canSendNow) {
      return;
    }

    setPrompt("");
    setAttachments([]);
    void sendConversation({ attachments: queuedAttachments, prompt: queuedPrompt });
  }

  function sendGitShortcut() {
    if (!canSendNow) {
      return;
    }

    void sendConversation({ prompt: "git" });
  }

  async function pickImageAttachment() {
    try {
      setError(null);
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        base64: true,
        mediaTypes: ["images"],
        quality: 0.85
      });

      if (result.canceled) {
        return;
      }

      setAttachments((current) => [
        ...current,
        ...result.assets.map((asset) => ({
          dataBase64: stripDataUrlPrefix(asset.base64 ?? ""),
          id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          mimeType: asset.mimeType ?? "image/jpeg",
          name: asset.fileName ?? `image-${Date.now()}.jpg`,
          uri: asset.uri
        }))
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to attach image");
    }
  }

  async function pickFileAttachment() {
    try {
      setError(null);
      const result = await DocumentPicker.getDocumentAsync({
        base64: true,
        copyToCacheDirectory: true,
        multiple: true
      });

      if (result.canceled) {
        return;
      }

      setAttachments((current) => [
        ...current,
        ...result.assets.map((asset) => ({
          dataBase64: stripDataUrlPrefix(asset.base64 ?? ""),
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          mimeType: asset.mimeType ?? "application/octet-stream",
          name: asset.name,
          uri: asset.uri
        }))
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to attach file");
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboardAvoidingScreen}
    >
      <FixedScreen>
        <View style={styles.chatHeader}>
          <Pressable
            accessibilityLabel="Back to project"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onBack}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <View style={styles.chatHeaderCopy}>
            <Text style={sharedStyles.label}>Conversation</Text>
            <Text numberOfLines={isHeaderExpanded ? 3 : 1} style={styles.chatHeaderTitle}>
              {conversation.prompt || "Codex"}
            </Text>
            {isHeaderExpanded ? (
              <Text style={sharedStyles.subtitle}>
                Messages are synced through Abitat Workspace.
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: isHeaderExpanded }}
            hitSlop={8}
            onPress={() => setIsHeaderExpanded((current) => !current)}
            style={styles.headerToggle}
          >
            <Text style={styles.headerToggleText}>{isHeaderExpanded ? "Collapse" : "Expand"}</Text>
          </Pressable>
        </View>
        <StatusPill status={status} />

        <View style={{ flex: 1 }}>
          <FlatList
            contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
            data={newestFirstMessages}
            inverted
            keyExtractor={(message) => message.id}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onContentSizeChange={handleMessagesContentSizeChange}
            onScroll={handleMessagesScroll}
            ref={listRef}
            renderItem={({ item: message }) => (
              <View
                style={[
                  sharedStyles.card,
                  {
                    alignSelf: message.role === "user" ? "flex-end" : "stretch",
                    backgroundColor: message.role === "user" ? colors.primarySoft : colors.surface,
                    maxWidth: message.role === "user" ? "88%" : "100%"
                  }
                ]}
              >
                <View style={styles.messageMetaRow}>
                  <Text style={sharedStyles.label}>{message.role}</Text>
                  {message.metadata?.localStatus === "sending" ? (
                    <Text style={styles.sendingLabel}>Sending</Text>
                  ) : null}
                  {message.metadata?.localStatus === "failed" ? (
                    <Text accessibilityLabel="Message failed to send" style={styles.failedSend}>
                      !
                    </Text>
                  ) : null}
                </View>
                <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 6 }}>
                  {safeMessageContent(message.content)}
                </Text>
              </View>
            )}
            scrollEventThrottle={16}
            style={{ flex: 1 }}
            windowSize={9}
          />
          {showScrollToLatestButton ? (
            <Pressable
              onPress={() => scrollToLatest(true)}
              style={[
                sharedStyles.secondaryButton,
                {
                  alignSelf: "center",
                  bottom: 12,
                  minHeight: 38,
                  paddingHorizontal: 14,
                  position: "absolute"
                }
              ]}
            >
              <Text style={sharedStyles.buttonText}>Latest</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

        <View style={styles.composerShell}>
          <CodexModelControls api={api} onChange={onModelSettingsChange} value={modelSettings} />
          {attachments.length > 0 ? (
            <View style={styles.attachmentList}>
              {attachments.map((attachment) => (
                <Pressable
                  accessibilityLabel={`Remove ${attachment.name}`}
                  accessibilityRole="button"
                  key={attachment.id}
                  onPress={() => removeAttachment(attachment.id)}
                  style={styles.attachmentChip}
                >
                  <Text numberOfLines={1} style={styles.attachmentChipText}>
                    {attachment.name}
                  </Text>
                  <Text style={styles.attachmentRemoveText}>x</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.composerActions}>
            <Pressable
              accessibilityLabel="Attach image"
              accessibilityRole="button"
              onPress={pickImageAttachment}
              style={styles.toolButton}
            >
              <Text style={styles.toolButtonText}>Image</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Attach file"
              accessibilityRole="button"
              onPress={pickFileAttachment}
              style={styles.toolButton}
            >
              <Text style={styles.toolButtonText}>File</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Commit and push with git"
              accessibilityRole="button"
              disabled={!canSendNow}
              onPress={sendGitShortcut}
              style={[styles.gitButton, !canSendNow ? styles.disabledAction : null]}
            >
              <Text style={styles.gitButtonText}>Git</Text>
            </Pressable>
          </View>
          <View style={styles.composerRow}>
            <TextInput
              multiline
              onChangeText={setPrompt}
              placeholder="Continue this Codex thread"
              placeholderTextColor={colors.muted}
              style={[sharedStyles.input, styles.composerInput]}
              value={prompt}
            />
            <View style={styles.composerButton}>
              <Button
                disabled={!canSendPrompt(prompt, attachments) || !canSendNow}
                onPress={continueConversation}
              >
                {sendButtonLabel(status, isSending)}
              </Button>
            </View>
          </View>
        </View>
      </FixedScreen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 12
  },
  backButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  chatHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12
  },
  chatHeaderCopy: {
    flex: 1,
    minWidth: 0
  },
  chatHeaderTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 23,
    marginTop: 3
  },
  attachmentChip: {
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    maxWidth: "100%",
    minHeight: 32,
    paddingHorizontal: 10
  },
  attachmentChipText: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700"
  },
  attachmentList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  attachmentRemoveText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900"
  },
  composerActions: {
    flexDirection: "row",
    gap: 8
  },
  composerButton: {
    justifyContent: "flex-end",
    width: 92
  },
  composerInput: {
    flex: 1,
    minHeight: 70,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  composerRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 10
  },
  composerShell: {
    gap: 10
  },
  disabledAction: {
    opacity: 0.55
  },
  failedSend: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: "900"
  },
  gitButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 14
  },
  gitButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900"
  },
  headerToggle: {
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  headerToggleText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  keyboardAvoidingScreen: {
    flex: 1
  },
  messageMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  sendingLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  toolButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 12
  },
  toolButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  }
});

function canSendPrompt(prompt: string, attachments: PendingAttachment[]) {
  return prompt.trim().length > 0 || attachments.length > 0;
}

function canAcceptConversationInput(status: string) {
  return !["awaiting_approval", "committing", "preparing", "queued", "running"].includes(status);
}

function shouldForceMessageRefreshAfterStatusPoll(input: {
  nextStatus: string;
  nextUpdatedAt: string | null;
  previousStatus: string;
  previousUpdatedAt: string | null;
}) {
  if (input.nextUpdatedAt && input.nextUpdatedAt !== input.previousUpdatedAt) {
    return true;
  }

  return (
    isConversationBusyStatus(input.previousStatus) && !isConversationBusyStatus(input.nextStatus)
  );
}

function isConversationBusyStatus(status: string) {
  return ["awaiting_approval", "committing", "preparing", "queued", "running"].includes(status);
}

function sendButtonLabel(status: string, isSending: boolean) {
  if (isSending) {
    return "Sending";
  }

  if (status === "awaiting_approval") {
    return "Waiting";
  }

  if (!canAcceptConversationInput(status)) {
    return "Running";
  }

  return "Send";
}

function promptForSend(prompt: string, attachments: PendingAttachment[]) {
  const trimmed = prompt.trim();

  if (trimmed) {
    return trimmed;
  }

  return attachments.length === 1 ? "Review the attached file." : "Review the attached files.";
}

function createOptimisticMessage(input: {
  attachmentNames: string[];
  clientMessageId: string;
  conversationId: string;
  createdAt: string;
  prompt: string;
  sequence: number;
}): ConversationMessage {
  return {
    content: optimisticMessageContent(input.prompt, input.attachmentNames),
    conversationId: input.conversationId,
    createdAt: input.createdAt,
    id: input.clientMessageId,
    metadata: {
      afterSequence: input.sequence - 1,
      attachmentNames: input.attachmentNames,
      clientMessageId: input.clientMessageId,
      localStatus: "sending",
      submittedPrompt: input.prompt
    },
    role: "user",
    sequence: input.sequence,
    sourceDeviceId: "ios"
  };
}

function optimisticMessageContent(prompt: string, attachmentNames: string[]) {
  if (attachmentNames.length === 0) {
    return prompt;
  }

  return `${prompt}\n\n${attachmentNames.map((name) => `[Attached: ${name}]`).join("\n")}`;
}

function markLocalMessageFailed(messages: ConversationMessage[], clientMessageId: string) {
  return messages.map((message) =>
    message.id === clientMessageId
      ? {
          ...message,
          metadata: {
            ...(message.metadata ?? {}),
            localStatus: "failed"
          }
        }
      : message
  );
}

function markLocalMessageSent(messages: ConversationMessage[], clientMessageId: string) {
  return messages.map((message) =>
    message.id === clientMessageId
      ? {
          ...message,
          metadata: {
            ...(message.metadata ?? {}),
            localStatus: "sent"
          }
        }
      : message
  );
}

async function uploadAttachment(
  api: ApiClient,
  attachment: PendingAttachment
): Promise<ConversationAttachment> {
  const dataBase64 =
    attachment.dataBase64 && attachment.dataBase64.length > 0
      ? attachment.dataBase64
      : await FileSystem.readAsStringAsync(attachment.uri, { encoding: "base64" });

  return api.uploadAttachment({
    dataBase64: stripDataUrlPrefix(dataBase64),
    fileName: attachment.name,
    mimeType: attachment.mimeType
  });
}

function stripDataUrlPrefix(dataBase64: string) {
  const marker = ";base64,";
  const markerIndex = dataBase64.indexOf(marker);

  return markerIndex >= 0 ? dataBase64.slice(markerIndex + marker.length) : dataBase64;
}

export function mergeConversationMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[]
) {
  const byId = new Map<string, ConversationMessage>();
  const serverMessages = incoming.filter((message) => !isLocalMessage(message));

  for (const message of [...current, ...incoming]) {
    if (isLocalMessage(message) && hasMatchingServerMessage(message, serverMessages)) {
      continue;
    }

    byId.set(messageMergeKey(message), message);
  }

  return [...byId.values()].sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function messageMergeKey(message: ConversationMessage) {
  const metadata = message.metadata ?? {};
  const codexThreadId = metadata.codexThreadId;
  const codexTurnId = metadata.codexTurnId;
  const codexItemId = metadata.codexItemId;

  if (
    typeof codexThreadId === "string" &&
    typeof codexTurnId === "string" &&
    typeof codexItemId === "string"
  ) {
    const codexItemType =
      typeof metadata.codexItemType === "string" ? metadata.codexItemType : message.role;
    const occurrence =
      typeof metadata.codexItemOccurrence === "number" ? metadata.codexItemOccurrence : 1;

    return `codex:${codexThreadId}:${codexTurnId}:${codexItemId}:${codexItemType}:${occurrence}`;
  }

  return message.id;
}

function isLocalMessage(message: ConversationMessage) {
  return (
    message.metadata?.localStatus === "sending" ||
    message.metadata?.localStatus === "sent" ||
    message.metadata?.localStatus === "failed"
  );
}

function hasMatchingServerMessage(
  localMessage: ConversationMessage,
  serverMessages: ConversationMessage[]
) {
  const submittedPrompt = localMessage.metadata?.submittedPrompt;
  const afterSequence = localMessage.metadata?.afterSequence;

  if (typeof submittedPrompt !== "string" || typeof afterSequence !== "number") {
    return false;
  }

  return serverMessages.some(
    (message) =>
      message.role === "user" &&
      message.sequence > afterSequence &&
      (message.content.trim() === submittedPrompt ||
        message.content.trim().startsWith(`${submittedPrompt}\n`) ||
        message.content.includes(submittedPrompt))
  );
}

export function visibleConversationMessages(messages: ConversationMessage[]) {
  return messages.filter((message) => message.role !== "runtime");
}

export function safeMessageContent(content: string) {
  const maxLength = 8_000;

  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength)}\n\n[Message truncated for iPhone stability.]`;
}
