import { useEffect, useMemo, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import type { ListRenderItemInfo, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  ActionSheetIOS,
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ApiClient } from "../api/client";
import { CodexModelControls } from "../components/CodexModelControls";
import { rememberRunningConversation } from "../notifications/thread-completion-notifications";
import {
  loadCachedConversationMessages,
  moveCachedConversationMessages,
  saveCachedConversationMessages
} from "../state/message-cache";
import { colors } from "../theme";
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
  refreshEnabled?: boolean;
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

type FeatherIconName = keyof typeof Feather.glyphMap;

const MESSAGE_POLL_INTERVAL_MS = 1800;
const STATUS_POLL_INTERVAL_MS = 2500;
const FULL_MESSAGE_REFRESH_INTERVAL_MS = 12000;
const COMPOSER_INPUT_MIN_HEIGHT = 48;
const COMPOSER_INPUT_MAX_HEIGHT = 132;
const GENERATED_FILES_MAX_HEIGHT = 188;

const CHAT_STARS = [
  { left: "5%", opacity: 0.42, size: 1, top: "8%" },
  { left: "22%", opacity: 0.25, size: 1, top: "16%" },
  { left: "38%", opacity: 0.46, size: 1.5, top: "7%" },
  { left: "61%", opacity: 0.26, size: 1, top: "15%" },
  { left: "91%", opacity: 0.36, size: 1, top: "10%" },
  { left: "13%", opacity: 0.5, size: 1.5, top: "31%" },
  { left: "56%", opacity: 0.38, size: 1, top: "28%" },
  { left: "88%", opacity: 0.18, size: 1.5, top: "36%" },
  { left: "6%", opacity: 0.28, size: 1, top: "54%" },
  { left: "33%", opacity: 0.18, size: 1, top: "61%" },
  { left: "72%", opacity: 0.44, size: 1.5, top: "57%" },
  { left: "95%", opacity: 0.32, size: 1, top: "68%" },
  { left: "15%", opacity: 0.48, size: 1.5, top: "82%" },
  { left: "42%", opacity: 0.28, size: 1, top: "89%" },
  { left: "67%", opacity: 0.46, size: 1.5, top: "83%" },
  { left: "90%", opacity: 0.34, size: 1, top: "92%" }
] as const;

export function ConversationScreen({
  api,
  conversation,
  messageCacheScope,
  modelSettings,
  onBack,
  onModelSettingsChange,
  refreshEnabled = true
}: ConversationScreenProps) {
  const [activeConversation, setActiveConversation] = useState(conversation);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [status, setStatus] = useState(conversation.status);
  const [error, setError] = useState<string | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFileSummary[]>([]);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [generatedFilesModalVisible, setGeneratedFilesModalVisible] = useState(false);
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
  const threadTitle = activeConversation.prompt || "New Thread";
  const collapsedThreadTitle = compactThreadTitle(threadTitle);
  const hasComposerPayload = canSendPrompt(prompt, attachments);
  const showComposerSpinner =
    (isConversationBusyStatus(status) || isSending) && !hasComposerPayload;
  const sendButtonIconName: FeatherIconName = isConversationBusyStatus(status)
    ? "arrow-up"
    : "send";

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
    setGeneratedFilesModalVisible(false);
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
    if (!refreshEnabled) {
      return;
    }

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
  }, [activeConversation.id, messageCacheScope, refreshEnabled]);

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
    if (!refreshEnabled) {
      return;
    }

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
    messageCacheScope,
    refreshEnabled
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

  async function steerQueuedMessage(message: ConversationMessage) {
    if (!canSteerQueuedLocalMessage(message, canSteerNow)) {
      return;
    }

    const submittedPrompt = queuedMessageSubmittedPrompt(message);
    if (!submittedPrompt) {
      return;
    }

    const clientMessageId = `ios-steer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conversationForSend = activeConversation;

    setError(null);
    setMessages((current) =>
      persistMergedConversationMessages(
        messageCacheScope,
        conversationForSend.id,
        markLocalMessageSending(
          conversationMessagesForId(current, conversationForSend.id),
          message.id
        )
      )
    );

    try {
      const continued = await api.continueConversation(conversationForSend.id, {
        attachments: [],
        clientMessageId,
        delivery: "steer",
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
          markLocalMessageSent(
            conversationMessagesForId(current, conversationForSend.id),
            message.id
          )
        )
      );

      try {
        const next = await api.listMessages(conversationForSend.id, lastSequence, {
          forceRefresh: true,
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
          markLocalMessageQueued(
            conversationMessagesForId(current, conversationForSend.id),
            message.id
          )
        )
      );
      setError(caught instanceof Error ? caught.message : "Unable to steer queued message");
    }
  }

  function openAttachmentMenu() {
    if (Platform.OS !== "ios") {
      void pickFileAttachment();
      return;
    }

    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 2,
        options: ["Image", "File", "Cancel"],
        title: "Attach"
      },
      (buttonIndex) => {
        if (buttonIndex === 0) {
          void pickImageAttachment();
        }
        if (buttonIndex === 1) {
          void pickFileAttachment();
        }
      }
    );
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

  function renderMessageItem({ item: message }: ListRenderItemInfo<ConversationMessage>) {
    const isUserMessage = message.role === "user";
    const localStatus =
      typeof message.metadata?.localStatus === "string" ? message.metadata.localStatus : null;
    const roleLabel = isUserMessage
      ? "USER"
      : message.role === "assistant"
        ? "CODEX"
        : message.role.toUpperCase();
    const canSteerQueued = canSteerQueuedLocalMessage(message, canSteerNow);

    return (
      <View
        style={[
          styles.messageBlock,
          isUserMessage ? styles.userMessageBlock : styles.codexMessageBlock
        ]}
      >
        <View
          style={[
            styles.messageMetaRow,
            isUserMessage ? styles.userMessageMetaRow : styles.codexMessageMetaRow
          ]}
        >
          <Text style={styles.messageRoleLabel}>{roleLabel}</Text>
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
          {localStatus === "sending" ? <Text style={styles.sendingLabel}>Sending</Text> : null}
          {localStatus === "queued" ? <Text style={styles.sendingLabel}>Queued</Text> : null}
          {canSteerQueued ? (
            <Pressable
              accessibilityLabel="Steer queued Codex message"
              accessibilityRole="button"
              onPress={() => void steerQueuedMessage(message)}
              style={styles.inlineSteerButton}
            >
              <Text style={styles.inlineSteerButtonText}>Steer</Text>
            </Pressable>
          ) : null}
          {localStatus === "failed" ? (
            <Text accessibilityLabel="Message failed to send" style={styles.failedSend}>
              !
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.messageCard,
            isUserMessage ? styles.userMessageCard : styles.codexMessageCard
          ]}
        >
          <Text
            selectable
            style={[
              styles.messageText,
              isUserMessage ? styles.userMessageText : styles.codexMessageText
            ]}
          >
            {safeMessageContent(message.content)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboardAvoidingScreen}
    >
      <SafeAreaView edges={["top", "left", "right"]} style={styles.conversationScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <View style={styles.conversationContent}>
          <View pointerEvents="none" style={styles.starField}>
            {CHAT_STARS.map((star, index) => (
              <View
                key={`chat-star-${index}`}
                style={[
                  styles.star,
                  {
                    height: star.size,
                    left: star.left,
                    opacity: star.opacity,
                    top: star.top,
                    width: star.size
                  }
                ]}
              />
            ))}
          </View>

          <View style={styles.chatHeader}>
            <View
              style={[styles.threadCluster, isHeaderExpanded ? styles.threadClusterExpanded : null]}
            >
              <Pressable
                accessibilityLabel="Toggle full thread name"
                accessibilityRole="button"
                accessibilityState={{ expanded: isHeaderExpanded }}
                onPress={() => setIsHeaderExpanded((current) => !current)}
                style={[styles.threadBubble, isHeaderExpanded ? styles.threadBubbleExpanded : null]}
              >
                <Text numberOfLines={isHeaderExpanded ? 3 : 1} style={styles.threadBubbleText}>
                  {isHeaderExpanded ? threadTitle : collapsedThreadTitle}
                </Text>
              </Pressable>
              <View
                accessibilityLabel={
                  isConversationBusyStatus(status) ? "Codex is running" : "Codex is finished"
                }
                style={[
                  styles.statusLed,
                  isConversationBusyStatus(status) ? styles.statusLedRunning : styles.statusLedDone
                ]}
              />
            </View>

            {!isHeaderExpanded ? (
              <View style={styles.headerActions}>
                <CodexModelControls
                  api={api}
                  onChange={onModelSettingsChange}
                  value={modelSettings}
                  variant="compact"
                />
                <Pressable
                  accessibilityLabel="Open generated files"
                  accessibilityRole="button"
                  onPress={() => setGeneratedFilesModalVisible(true)}
                  style={styles.generatedFilesButton}
                >
                  <Feather color="#d9d9df" name="file-text" size={18} />
                  {generatedFiles.length > 0 ? <View style={styles.generatedFilesDot} /> : null}
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={{ flex: 1 }}>
            <FlatList
              contentContainerStyle={styles.messageList}
              data={newestFirstMessages}
              inverted
              keyExtractor={(message) => message.id}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              onContentSizeChange={handleMessagesContentSizeChange}
              onScroll={handleMessagesScroll}
              ref={listRef}
              renderItem={renderMessageItem}
              scrollEventThrottle={16}
              style={{ flex: 1 }}
              windowSize={9}
            />
            {showScrollToLatestButton ? (
              <Pressable
                accessibilityLabel="Scroll to latest message"
                accessibilityRole="button"
                onPress={() => scrollToLatest(true)}
                style={styles.latestButton}
              >
                <Feather
                  color="#ffffff"
                  name="arrow-down"
                  size={20}
                  style={styles.latestButtonIcon}
                />
              </Pressable>
            ) : null}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

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
            <View style={styles.composerRow}>
              <Pressable
                accessibilityLabel="Attach files or images"
                accessibilityRole="button"
                onPress={openAttachmentMenu}
                style={styles.composerPlusButton}
              >
                <Feather color="#f5f5f5" name="plus" size={24} />
              </Pressable>
              <TextInput
                contextMenuHidden={false}
                multiline
                onChangeText={setPrompt}
                placeholder="Enter celestial command..."
                placeholderTextColor={colors.muted}
                scrollEnabled
                style={styles.composerInput}
                value={prompt}
              />
              <Pressable
                accessibilityLabel={
                  isConversationBusyStatus(status) ? "Queue message" : "Send message"
                }
                accessibilityRole="button"
                disabled={!hasComposerPayload || !canSendNow}
                onPress={continueConversation}
                style={[
                  styles.composerSendButton,
                  isConversationBusyStatus(status)
                    ? styles.composerSendButtonBusy
                    : styles.composerSendButtonIdle,
                  !hasComposerPayload || !canSendNow ? styles.disabledAction : null
                ]}
              >
                {showComposerSpinner ? (
                  <ActivityIndicator color="#080808" size="small" />
                ) : (
                  <Feather color="#080808" name={sendButtonIconName} size={18} />
                )}
              </Pressable>
            </View>
          </View>

          <Modal
            animationType="fade"
            onRequestClose={() => setGeneratedFilesModalVisible(false)}
            transparent
            visible={generatedFilesModalVisible}
          >
            <View style={styles.generatedFilesModalBackdrop}>
              <View style={styles.generatedFilesModal}>
                <View style={styles.generatedFilesModalHeader}>
                  <Text style={styles.generatedFilesModalTitle}>Generated files</Text>
                  <Pressable
                    accessibilityLabel="Close generated files"
                    accessibilityRole="button"
                    onPress={() => setGeneratedFilesModalVisible(false)}
                    style={styles.generatedFilesCloseButton}
                  >
                    <Feather color="#f5f5f5" name="x" size={18} />
                  </Pressable>
                </View>
                <ScrollView
                  nestedScrollEnabled
                  contentContainerStyle={styles.generatedFilesList}
                  style={styles.generatedFilesModalScroll}
                >
                  {generatedFiles.length === 0 ? (
                    <Text style={styles.generatedFilesEmptyText}>
                      No generated files are available yet.
                    </Text>
                  ) : (
                    generatedFiles.map((file) => (
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
                        <Feather color="#d9d9df" name="file" size={16} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={styles.generatedFileName}>
                            {file.name}
                          </Text>
                          <Text style={styles.generatedFileMeta}>
                            {downloadingFileId === file.id ? "Opening" : formatFileSize(file.size)}
                          </Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
  chatHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 44
  },
  codexMessageBlock: {
    alignItems: "stretch",
    width: "100%"
  },
  codexMessageCard: {
    backgroundColor: "rgba(0,0,0,0.36)",
    borderColor: "rgba(255,255,255,0.13)",
    borderWidth: 1
  },
  codexMessageMetaRow: {
    justifyContent: "flex-start"
  },
  codexMessageText: {
    color: "#e6e6e9"
  },
  composerInput: {
    backgroundColor: "transparent",
    borderWidth: 0,
    color: "#f2f2f2",
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    minHeight: COMPOSER_INPUT_MIN_HEIGHT,
    paddingHorizontal: 10,
    paddingVertical: 13,
    textAlignVertical: "top"
  },
  composerPlusButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  composerRow: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderColor: "rgba(255,255,255,0.13)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8
  },
  composerSendButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 44,
    justifyContent: "center",
    marginRight: 4,
    width: 44
  },
  composerSendButtonBusy: {
    backgroundColor: "#ffffff"
  },
  composerSendButtonIdle: {
    backgroundColor: "#ffffff"
  },
  composerShell: {
    backgroundColor: "#000000",
    gap: 10,
    paddingBottom: 22,
    paddingTop: 4
  },
  conversationContent: {
    backgroundColor: "#000000",
    flex: 1,
    gap: 6,
    paddingHorizontal: 18,
    paddingTop: 8
  },
  conversationScreen: {
    backgroundColor: "#000000",
    flex: 1
  },
  copyButton: {
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 22,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  copyButtonText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 10,
    fontWeight: "800"
  },
  disabledAction: {
    opacity: 0.48
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700"
  },
  failedSend: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: "900"
  },
  generatedFileChip: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  generatedFileMeta: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 11,
    fontWeight: "700"
  },
  generatedFileName: {
    color: "#f5f5f5",
    fontSize: 12,
    fontWeight: "800",
    maxWidth: "100%"
  },
  generatedFilesButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.13)",
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    position: "relative",
    width: 34
  },
  generatedFilesCloseButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  generatedFilesDot: {
    backgroundColor: colors.danger,
    borderRadius: 999,
    bottom: 6,
    height: 6,
    position: "absolute",
    right: 7,
    width: 6
  },
  generatedFilesEmptyText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 13,
    lineHeight: 18
  },
  generatedFilesList: {
    gap: 8,
    paddingBottom: 2,
    paddingTop: 6
  },
  generatedFilesModal: {
    backgroundColor: "rgba(0,0,0,0.92)",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: "72%",
    padding: 16,
    width: "88%"
  },
  generatedFilesModalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.68)",
    flex: 1,
    justifyContent: "center"
  },
  generatedFilesModalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 36
  },
  generatedFilesModalScroll: {
    maxHeight: GENERATED_FILES_MAX_HEIGHT
  },
  generatedFilesModalTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800"
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    flexShrink: 0
  },
  inlineSteerButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 24,
    paddingHorizontal: 9
  },
  inlineSteerButtonText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800"
  },
  keyboardAvoidingScreen: {
    backgroundColor: "#000000",
    flex: 1
  },
  latestButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.58)",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    borderWidth: 1,
    bottom: 8,
    height: 42,
    justifyContent: "center",
    position: "absolute",
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    width: 42
  },
  latestButtonIcon: {
    opacity: 0.92
  },
  messageBlock: {
    gap: 7,
    marginBottom: 16
  },
  messageCard: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16
  },
  messageList: {
    gap: 2,
    paddingBottom: 14,
    paddingTop: 14
  },
  messageMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  messageRoleLabel: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase"
  },
  messageText: {
    fontSize: 17,
    lineHeight: 25
  },
  sendingLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "800"
  },
  star: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    position: "absolute"
  },
  starField: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000"
  },
  statusLed: {
    borderRadius: 999,
    height: 9,
    width: 9
  },
  statusLedDone: {
    backgroundColor: "#22c55e",
    shadowColor: "#22c55e",
    shadowOpacity: 0.72,
    shadowRadius: 7
  },
  statusLedRunning: {
    backgroundColor: "#a80000",
    shadowColor: "#ff0000",
    shadowOpacity: 0.72,
    shadowRadius: 7
  },
  threadBubble: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.13)",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    maxWidth: 112,
    minHeight: 34,
    paddingHorizontal: 14
  },
  threadBubbleExpanded: {
    alignItems: "flex-start",
    flex: 1,
    maxWidth: "100%",
    paddingVertical: 9
  },
  threadBubbleText: {
    color: "#f1f1f3",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase"
  },
  threadCluster: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 8,
    maxWidth: 134,
    minWidth: 0
  },
  threadClusterExpanded: {
    flex: 1,
    maxWidth: "100%"
  },
  userMessageBlock: {
    alignItems: "flex-end",
    alignSelf: "flex-end",
    maxWidth: "86%"
  },
  userMessageCard: {
    backgroundColor: "#eeeeee",
    shadowColor: "#e2e2ff",
    shadowOpacity: 0.16,
    shadowRadius: 16
  },
  userMessageMetaRow: {
    justifyContent: "flex-end"
  },
  userMessageText: {
    color: "#111111"
  }
});

function canSendPrompt(prompt: string, attachments: PendingAttachment[]) {
  return prompt.trim().length > 0 || attachments.length > 0;
}

function compactThreadTitle(title: string) {
  const trimmedTitle = title.trim();
  if (trimmedTitle.length <= 6) {
    return trimmedTitle;
  }

  return `${trimmedTitle.slice(0, 6)}...`;
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

function markLocalMessageSending(messages: ConversationMessage[], clientMessageId: string) {
  return messages.map((message) =>
    message.id === clientMessageId
      ? {
          ...message,
          metadata: {
            ...(message.metadata ?? {}),
            localStatus: "sending"
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

function canSteerQueuedLocalMessage(message: ConversationMessage, canSteerNow: boolean) {
  return canSteerNow && message.metadata?.localStatus === "queued";
}

function queuedMessageSubmittedPrompt(message: ConversationMessage) {
  const submittedPrompt = message.metadata?.submittedPrompt;

  if (typeof submittedPrompt === "string" && submittedPrompt.trim().length > 0) {
    return submittedPrompt.trim();
  }

  const content = stripCodexAppDirectives(message.content).trim();
  return content.length > 0 ? content : null;
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
