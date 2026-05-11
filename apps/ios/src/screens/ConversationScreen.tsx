import { useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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
import {
  loadCachedConversationMessages,
  moveCachedConversationMessages,
  saveCachedConversationMessages
} from "../state/message-cache";
import { colors, sharedStyles } from "../theme";
import type {
  CodexMobileModelSettings,
  ConversationAttachment,
  ConversationMessage,
  ConversationSummary,
  GeneratedFileSummary
} from "../types";

interface ConversationScreenProps {
  api: ApiClient;
  conversation: ConversationSummary;
  messageCacheScope: string;
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
  delivery?: "queue" | "steer";
  prompt: string;
}

const MESSAGE_POLL_INTERVAL_MS = 1800;
const STATUS_POLL_INTERVAL_MS = 2500;
const FULL_MESSAGE_REFRESH_INTERVAL_MS = 12000;
const COMPOSER_INPUT_MIN_HEIGHT = 48;
const COMPOSER_INPUT_MAX_HEIGHT = 132;
const GENERATED_FILES_MAX_HEIGHT = 188;

export function ConversationScreen({
  api,
  conversation,
  messageCacheScope,
  modelSettings,
  onBack,
  onModelSettingsChange
}: ConversationScreenProps) {
  const [activeConversation, setActiveConversation] = useState(conversation);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [status, setStatus] = useState(conversation.status);
  const [error, setError] = useState<string | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFileSummary[]>([]);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [isGeneratedFilesExpanded, setIsGeneratedFilesExpanded] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showScrollToLatestButton, setShowScrollToLatestButton] = useState(false);
  const [messageCacheLoadKey, setMessageCacheLoadKey] = useState(0);
  const listRef = useRef<FlatList<ConversationMessage> | null>(null);
  const activeMessages = useMemo(
    () => conversationMessagesForId(messages, activeConversation.id),
    [activeConversation.id, messages]
  );
  const newestFirstMessages = useMemo(
    () => visibleConversationMessages(activeMessages).reverse(),
    [activeMessages]
  );
  const lastSequence = useMemo(
    () => activeMessages.reduce((max, message) => Math.max(max, message.sequence), 0),
    [activeMessages]
  );
  const latestMessageId =
    activeMessages.length > 0 ? activeMessages[activeMessages.length - 1]?.id : "";
  const pendingAutoScrollRef = useRef(true);
  const latestSequenceRef = useRef(0);
  const loadedCachedConversationIdRef = useRef<string | null>(null);
  const latestConversationUpdatedAtRef = useRef<string | null>(conversation.updatedAt ?? null);
  const latestStatusRef = useRef(conversation.status);
  const activeConversationIdRef = useRef(conversation.id);
  const lastFullMessageRefreshAtRef = useRef(0);
  const generatedFileRefreshInFlightRef = useRef(false);
  const messageRefreshInFlightRef = useRef(false);
  const pendingFullMessageRefreshRef = useRef(false);
  const sendingCountRef = useRef(0);
  const canSendNow = !isDraftConversation(activeConversation) || !isSending;
  const canSteerNow = !isDraftConversation(activeConversation) && isConversationBusyStatus(status);

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
    setActiveConversation(conversation);
    setError(null);
    setPrompt("");
    setAttachments([]);
    setGeneratedFiles([]);
    setDownloadingFileId(null);
    setIsGeneratedFilesExpanded(false);
    setStatus(conversation.status);
    setIsHeaderExpanded(false);
    setCopiedMessageId(null);
    pendingAutoScrollRef.current = true;
    if (isDraftConversation(conversation)) {
      setMessages([]);
      latestSequenceRef.current = 0;
      loadedCachedConversationIdRef.current = conversation.id;
    } else {
      loadedCachedConversationIdRef.current = null;
    }
    activeConversationIdRef.current = conversation.id;
    latestConversationUpdatedAtRef.current = conversation.updatedAt ?? null;
    latestStatusRef.current = conversation.status;
    lastFullMessageRefreshAtRef.current = 0;
    generatedFileRefreshInFlightRef.current = false;
    messageRefreshInFlightRef.current = false;
    pendingFullMessageRefreshRef.current = false;
  }, [conversation]);

  useEffect(() => {
    if (isDraftConversation(activeConversation)) {
      return;
    }

    let cancelled = false;

    async function loadCachedMessages() {
      const cachedMessages = await loadCachedConversationMessages(
        messageCacheScope,
        activeConversation.id
      );

      if (cancelled) {
        return;
      }

      loadedCachedConversationIdRef.current = activeConversation.id;
      setMessages(cachedMessages);
      latestSequenceRef.current = highestCachedMessageSequence(cachedMessages);
      pendingAutoScrollRef.current = true;
      setMessageCacheLoadKey((current) => current + 1);
    }

    void loadCachedMessages();

    return () => {
      cancelled = true;
    };
  }, [activeConversation.id, messageCacheScope]);

  async function refreshGeneratedFiles(conversationId = activeConversationIdRef.current) {
    if (isDraftConversationId(conversationId) || generatedFileRefreshInFlightRef.current) {
      if (isDraftConversationId(conversationId)) {
        setGeneratedFiles([]);
      }
      return;
    }

    generatedFileRefreshInFlightRef.current = true;
    try {
      const files = await api.listGeneratedFiles(conversationId);
      if (activeConversationIdRef.current === conversationId) {
        setGeneratedFiles(files);
      }
    } catch (caught) {
      if (activeConversationIdRef.current === conversationId && !isTransientResponseError(caught)) {
        setError(caught instanceof Error ? caught.message : "Unable to load generated files");
      }
    } finally {
      generatedFileRefreshInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (isDraftConversation(activeConversation)) {
      setGeneratedFiles([]);
      return;
    }

    let cancelled = false;

    async function refreshMessages(
      afterSequence?: number,
      options: { forceRefresh?: boolean } = {}
    ) {
      if (loadedCachedConversationIdRef.current !== activeConversation.id) {
        return;
      }

      const isForcedRefresh = options.forceRefresh === true || typeof afterSequence !== "number";
      const cachedAfterSequence =
        typeof afterSequence === "number" ? afterSequence : latestSequenceRef.current;
      if (messageRefreshInFlightRef.current) {
        if (isForcedRefresh) {
          pendingFullMessageRefreshRef.current = true;
        }
        return;
      }

      messageRefreshInFlightRef.current = true;
      try {
        const nextMessages = await api.listMessages(
          activeConversation.id,
          cachedAfterSequence > 0 ? cachedAfterSequence : undefined,
          {
            forceRefresh: isForcedRefresh,
            includeRuntime: false
          }
        );
        if (!cancelled) {
          if (isForcedRefresh) {
            lastFullMessageRefreshAtRef.current = Date.now();
          }
          setError(null);
          setMessages((current) =>
            persistMergedConversationMessages(
              messageCacheScope,
              activeConversation.id,
              mergeConversationMessages(
                conversationMessagesForId(current, activeConversation.id),
                nextMessages
              )
            )
          );
          if (isForcedRefresh || nextMessages.length > 0) {
            void refreshGeneratedFiles(activeConversation.id);
          }
        }
      } catch (caught) {
        if (!cancelled) {
          if (!isTransientResponseError(caught)) {
            setError(caught instanceof Error ? caught.message : "Unable to load messages");
          }
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
      const shouldForceRefresh =
        Date.now() - lastFullMessageRefreshAtRef.current >= FULL_MESSAGE_REFRESH_INTERVAL_MS;

      void refreshMessages(latestSequenceRef.current, { forceRefresh: shouldForceRefresh });
    }

    async function refreshStatus() {
      try {
        const latestConversations = await api.listConversations(activeConversation.projectId);
        const latestConversation = latestConversations.find(
          (candidate) => candidate.id === activeConversation.id
        );
        if (!cancelled) {
          const nextStatus = latestConversation?.status ?? activeConversation.status;
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
            void refreshMessages(latestSequenceRef.current, { forceRefresh: true });
            void refreshGeneratedFiles(activeConversation.id);
          }
        }
      } catch (caught) {
        if (!cancelled) {
          if (!isTransientResponseError(caught)) {
            setError(caught instanceof Error ? caught.message : "Unable to refresh Codex status");
          }
        }
      }
    }

    void refreshMessages();
    void refreshStatus();
    void refreshGeneratedFiles(activeConversation.id);
    const messageTimer = setInterval(refreshMessagesForPoll, MESSAGE_POLL_INTERVAL_MS);
    const statusTimer = setInterval(refreshStatus, STATUS_POLL_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshMessages();
        void refreshStatus();
        void refreshGeneratedFiles(activeConversation.id);
      }
    });

    return () => {
      cancelled = true;
      clearInterval(messageTimer);
      clearInterval(statusTimer);
      appStateSubscription.remove();
    };
  }, [
    api,
    activeConversation.id,
    activeConversation.projectId,
    activeConversation.status,
    messageCacheLoadKey,
    messageCacheScope
  ]);

  useEffect(() => {
    pendingAutoScrollRef.current = true;
    const timer = setTimeout(() => scrollToLatest(true), 50);

    return () => {
      clearTimeout(timer);
    };
  }, [latestMessageId]);

  async function sendConversation(input: SendConversationInput) {
    const conversationForSend = activeConversation;
    const isStartingDraftConversation = isDraftConversation(conversationForSend);
    const queuedAttachments = input.attachments ?? [];
    const delivery = input.delivery ?? "queue";
    const submittedPrompt = promptForSend(input.prompt, queuedAttachments);
    const clientMessageId = `ios-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const afterSequence = lastSequence;
    const optimisticMessage = createOptimisticMessage({
      attachmentNames: queuedAttachments.map((attachment) => attachment.name),
      clientMessageId,
      conversationId: conversationForSend.id,
      createdAt: new Date().toISOString(),
      prompt: submittedPrompt,
      sequence: afterSequence + 1
    });

    setError(null);
    setMessages((current) =>
      persistMergedConversationMessages(
        messageCacheScope,
        conversationForSend.id,
        mergeConversationMessages(conversationMessagesForId(current, conversationForSend.id), [
          optimisticMessage
        ])
      )
    );
    pendingAutoScrollRef.current = true;

    sendingCountRef.current += 1;
    setIsSending(true);
    try {
      const uploadedAttachments = await Promise.all(
        queuedAttachments.map((attachment) => uploadAttachment(api, attachment))
      );

      const uploadedConversationAttachments = uploadedAttachments.map((attachment) => ({
        kind: attachment.kind,
        name: attachment.name,
        path: attachment.path
      }));

      if (isStartingDraftConversation) {
        const started = await api.createConversation(conversationForSend.projectId, {
          attachments: uploadedConversationAttachments,
          clientMessageId,
          effort: modelSettings.effort,
          model: modelSettings.model,
          prompt: submittedPrompt
        });
        const nextConversation = {
          ...conversationForSend,
          id: started.conversationId,
          prompt: submittedPrompt,
          status: started.status,
          updatedAt: new Date().toISOString()
        };

        latestStatusRef.current = started.status;
        activeConversationIdRef.current = started.conversationId;
        loadedCachedConversationIdRef.current = started.conversationId;
        latestConversationUpdatedAtRef.current = nextConversation.updatedAt ?? null;
        setActiveConversation(nextConversation);
        setStatus(started.status);
        rememberRunningConversation(started.conversationId);
        void moveCachedConversationMessages(
          messageCacheScope,
          conversationForSend.id,
          started.conversationId
        );
        setMessages((current) =>
          persistMergedConversationMessages(
            messageCacheScope,
            started.conversationId,
            markLocalMessageSent(
              reassignLocalConversationMessages(
                conversationMessagesForId(current, conversationForSend.id),
                conversationForSend.id,
                started.conversationId
              ),
              clientMessageId
            )
          )
        );
        try {
          const next = await api.listMessages(started.conversationId, afterSequence, {
            includeRuntime: false
          });
          setMessages((current) =>
            persistMergedConversationMessages(
              messageCacheScope,
              started.conversationId,
              mergeConversationMessages(
                conversationMessagesForId(current, started.conversationId),
                next
              )
            )
          );
          void refreshGeneratedFiles(started.conversationId);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Unable to refresh Codex messages");
        }
        return;
      }

      const continued = await api.continueConversation(conversationForSend.id, {
        attachments: uploadedConversationAttachments,
        clientMessageId,
        delivery,
        effort: modelSettings.effort,
        model: modelSettings.model,
        prompt: submittedPrompt
      });
      setStatus(
        continued.status === "queued" && isConversationBusyStatus(status)
          ? status
          : continued.status
      );
      rememberRunningConversation(conversationForSend.id);
      setMessages((current) =>
        persistMergedConversationMessages(
          messageCacheScope,
          conversationForSend.id,
          continued.status === "queued"
            ? markLocalMessageQueued(
                conversationMessagesForId(current, conversationForSend.id),
                clientMessageId
              )
            : markLocalMessageSent(
                conversationMessagesForId(current, conversationForSend.id),
                clientMessageId
              )
        )
      );
      try {
        const next = await api.listMessages(conversationForSend.id, afterSequence, {
          includeRuntime: false
        });
        setMessages((current) =>
          persistMergedConversationMessages(
            messageCacheScope,
            conversationForSend.id,
            mergeConversationMessages(
              conversationMessagesForId(current, conversationForSend.id),
              next
            )
          )
        );
        void refreshGeneratedFiles(conversationForSend.id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to refresh Codex messages");
      }
    } catch (caught) {
      setMessages((current) =>
        persistMergedConversationMessages(
          messageCacheScope,
          conversationForSend.id,
          markLocalMessageFailed(
            conversationMessagesForId(current, conversationForSend.id),
            clientMessageId
          )
        )
      );
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
    void sendConversation({
      attachments: queuedAttachments,
      delivery: "queue",
      prompt: queuedPrompt
    });
  }

  function steerConversation() {
    const queuedPrompt = prompt;
    const queuedAttachments = attachments;

    if (!canSendPrompt(queuedPrompt, queuedAttachments) || !canSteerNow) {
      return;
    }

    setPrompt("");
    setAttachments([]);
    void sendConversation({
      attachments: queuedAttachments,
      delivery: "steer",
      prompt: queuedPrompt
    });
  }

  function sendGitShortcut() {
    if (!canSendNow) {
      return;
    }

    void sendConversation({ delivery: "queue", prompt: "git" });
  }

  async function copyMessageText(message: ConversationMessage) {
    const text = stripCodexAppDirectives(message.content);
    if (!text) {
      return;
    }

    await Clipboard.setStringAsync(text);
    setCopiedMessageId(message.id);
    setTimeout(() => {
      setCopiedMessageId((current) => (current === message.id ? null : current));
    }, 1600);
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

  async function downloadGeneratedFile(file: GeneratedFileSummary) {
    if (isDraftConversation(activeConversation)) {
      return;
    }

    try {
      setError(null);
      setDownloadingFileId(file.id);
      const download = await api.downloadGeneratedFile(activeConversation.id, file.id);
      const documentDirectory = FileSystem.documentDirectory;
      if (!documentDirectory) {
        throw new Error("File downloads are unavailable on this device");
      }

      const uri = `${documentDirectory}${safeLocalFileName(download.name)}`;
      await FileSystem.writeAsStringAsync(uri, download.dataBase64, {
        encoding: FileSystem.EncodingType.Base64
      });

      if (!(await Sharing.isAvailableAsync())) {
        setError(`Downloaded ${download.name}, but sharing is unavailable on this device`);
        return;
      }

      await Sharing.shareAsync(uri, {
        dialogTitle: download.name,
        mimeType: download.mimeType
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to download generated file");
    } finally {
      setDownloadingFileId(null);
    }
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
              {activeConversation.prompt || "New Thread"}
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
                  <Pressable
                    accessibilityLabel={`Copy ${message.role} message`}
                    accessibilityRole="button"
                    onPress={() => void copyMessageText(message)}
                    style={styles.copyButton}
                  >
                    <Text style={styles.copyButtonText}>
                      {copiedMessageId === message.id ? "Copied" : "Copy"}
                    </Text>
                  </Pressable>
                  {message.metadata?.localStatus === "sending" ? (
                    <Text style={styles.sendingLabel}>Sending</Text>
                  ) : null}
                  {message.metadata?.localStatus === "queued" ? (
                    <Text style={styles.sendingLabel}>Queued</Text>
                  ) : null}
                  {message.metadata?.localStatus === "failed" ? (
                    <Text accessibilityLabel="Message failed to send" style={styles.failedSend}>
                      !
                    </Text>
                  ) : null}
                </View>
                <Text
                  selectable
                  style={{ color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 6 }}
                >
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

        {generatedFiles.length > 0 ? (
          <View style={styles.generatedFilesPanel}>
            <Pressable
              accessibilityLabel="Toggle generated files"
              accessibilityRole="button"
              accessibilityState={{ expanded: isGeneratedFilesExpanded }}
              hitSlop={8}
              onPress={() => setIsGeneratedFilesExpanded((current) => !current)}
              style={styles.generatedFilesHeader}
            >
              <Text style={sharedStyles.label}>Generated files</Text>
              <Text style={styles.generatedFilesHeaderMeta}>
                {generatedFiles.length} {generatedFiles.length === 1 ? "file" : "files"} ·{" "}
                {isGeneratedFilesExpanded ? "Hide" : "Show"}
              </Text>
            </Pressable>
            {isGeneratedFilesExpanded ? (
              <ScrollView
                nestedScrollEnabled
                contentContainerStyle={styles.generatedFilesList}
                style={styles.generatedFilesScroll}
              >
                {generatedFiles.map((file) => (
                  <Pressable
                    accessibilityLabel={`Download ${file.name}`}
                    accessibilityRole="button"
                    disabled={downloadingFileId === file.id}
                    key={file.id}
                    onPress={() => void downloadGeneratedFile(file)}
                    style={[
                      styles.generatedFileChip,
                      downloadingFileId === file.id ? styles.disabledAction : null
                    ]}
                  >
                    <Text numberOfLines={1} style={styles.generatedFileName}>
                      {file.name}
                    </Text>
                    <Text style={styles.generatedFileMeta}>
                      {downloadingFileId === file.id ? "Opening" : formatFileSize(file.size)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : null}

        <View style={styles.composerShell}>
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
            <CodexModelControls
              api={api}
              onChange={onModelSettingsChange}
              value={modelSettings}
              variant="compact"
            />
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
              contextMenuHidden={false}
              multiline
              onChangeText={setPrompt}
              placeholder="Continue this Codex thread"
              placeholderTextColor={colors.muted}
              scrollEnabled
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
              <Pressable
                accessibilityLabel="Steer running Codex turn"
                accessibilityRole="button"
                disabled={!canSendPrompt(prompt, attachments) || !canSteerNow}
                onPress={steerConversation}
                style={[
                  styles.steerButton,
                  !canSendPrompt(prompt, attachments) || !canSteerNow ? styles.disabledAction : null
                ]}
              >
                <Text style={styles.steerButtonText}>Steer</Text>
              </Pressable>
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
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  composerButton: {
    gap: 8,
    justifyContent: "flex-end",
    width: 92
  },
  composerInput: {
    flex: 1,
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    minHeight: COMPOSER_INPUT_MIN_HEIGHT,
    paddingBottom: 12,
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
  copyButton: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  copyButtonText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800"
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
  generatedFileChip: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 3,
    maxWidth: "100%",
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 7,
    width: "48%"
  },
  generatedFileMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700"
  },
  generatedFileName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    maxWidth: "100%"
  },
  generatedFilesList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 2
  },
  generatedFilesPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10
  },
  generatedFilesHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minHeight: 32
  },
  generatedFilesHeaderMeta: {
    color: colors.muted,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "800"
  },
  generatedFilesScroll: {
    maxHeight: GENERATED_FILES_MAX_HEIGHT
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
  steerButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 12
  },
  steerButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900"
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

function isDraftConversation(conversation: ConversationSummary) {
  return conversation.status === "draft" || isDraftConversationId(conversation.id);
}

function isDraftConversationId(conversationId: string) {
  return conversationId.startsWith("draft:");
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
  if (status === "awaiting_approval") {
    return "Queue";
  }

  if (!canAcceptConversationInput(status)) {
    return "Queue";
  }

  if (isSending) {
    return "Sending";
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

function markLocalMessageQueued(messages: ConversationMessage[], clientMessageId: string) {
  return messages.map((message) =>
    message.id === clientMessageId
      ? {
          ...message,
          metadata: {
            ...(message.metadata ?? {}),
            localStatus: "queued"
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

function reassignLocalConversationMessages(
  messages: ConversationMessage[],
  fromConversationId: string,
  toConversationId: string
) {
  return messages.map((message) =>
    message.conversationId === fromConversationId
      ? { ...message, conversationId: toConversationId }
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

function safeLocalFileName(name: string) {
  const safeName = name
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return safeName || `abitat-file-${Date.now()}`;
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isTransientResponseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Unexpected end of JSON input") ||
    message.includes("Empty response from") ||
    message.includes("Invalid JSON response")
  );
}

function highestCachedMessageSequence(messages: ConversationMessage[]) {
  return messages.reduce((highest, message) => Math.max(highest, message.sequence), 0);
}

function persistMergedConversationMessages(
  messageCacheScope: string,
  conversationId: string,
  nextMessages: ConversationMessage[]
) {
  void saveCachedConversationMessages(messageCacheScope, conversationId, nextMessages);
  return nextMessages;
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
    message.metadata?.localStatus === "queued" ||
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
  return messages.filter(
    (message) =>
      message.role !== "runtime" && stripCodexAppDirectives(message.content).trim().length > 0
  );
}

function conversationMessagesForId(messages: ConversationMessage[], conversationId: string) {
  return messages.filter((message) => message.conversationId === conversationId);
}

export function safeMessageContent(content: string) {
  const maxLength = 8_000;
  const visibleContent = stripCodexAppDirectives(content);

  if (visibleContent.length <= maxLength) {
    return visibleContent;
  }

  return `${visibleContent.slice(0, maxLength)}\n\n[Message truncated for iPhone stability.]`;
}

export function stripCodexAppDirectives(content: string) {
  return content
    .split(/\r?\n/)
    .filter((line) => !isCodexAppDirectiveLine(line))
    .join("\n")
    .trim();
}

function isCodexAppDirectiveLine(line: string) {
  return /^::(?:git-stage|git-commit|git-push|git-create-branch|git-create-pr|archive)\{.*\}\s*$/.test(
    line.trim()
  );
}
