import { useEffect, useMemo, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View
} from "react-native";

import type { ApiClient } from "../api/client";
import { Button, Header, StatusPill } from "../components/Controls";
import { rememberRunningConversation } from "../notifications/thread-completion-notifications";
import { FixedScreen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type { ConversationMessage, ConversationSummary } from "../types";

interface ConversationScreenProps {
  api: ApiClient;
  conversation: ConversationSummary;
}

export function ConversationScreen({ api, conversation }: ConversationScreenProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState(conversation.status);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isWaitingForMacThread, setIsWaitingForMacThread] = useState(() =>
    shouldWaitForMacRunningThread(conversation)
  );
  const [showScrollToLatestButton, setShowScrollToLatestButton] = useState(false);
  const listRef = useRef<FlatList<ConversationMessage> | null>(null);
  const newestFirstMessages = useMemo(() => [...messages].reverse(), [messages]);
  const lastSequence = useMemo(
    () => messages.reduce((max, message) => Math.max(max, message.sequence), 0),
    [messages]
  );
  const latestMessageId = messages.length > 0 ? messages[messages.length - 1]?.id : "";
  const pendingAutoScrollRef = useRef(true);

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
    let cancelled = false;

    async function refresh() {
      try {
        if (isWaitingForMacThread) {
          const latestConversation = (await api.listConversations(conversation.projectId)).find(
            (candidate) => candidate.id === conversation.id
          );

          if (!cancelled && latestConversation) {
            setError(null);
            setStatus(latestConversation.status);
            setIsWaitingForMacThread(shouldWaitForMacRunningThread(latestConversation));
          }

          return;
        }

        const nextMessages = await api.listMessages(conversation.id);
        if (!cancelled) {
          setError(null);
          setMessages(mergeConversationMessages([], nextMessages));
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to load messages");
        }
      }
    }

    void refresh();
    const timer = setInterval(refresh, isWaitingForMacThread ? 3000 : 1800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, conversation.id, conversation.projectId, isWaitingForMacThread]);

  useEffect(() => {
    setError(null);
    setMessages([]);
    setPrompt("");
    setStatus(conversation.status);
    setIsWaitingForMacThread(shouldWaitForMacRunningThread(conversation));
    pendingAutoScrollRef.current = true;
  }, [conversation]);

  useEffect(() => {
    pendingAutoScrollRef.current = true;
    const timer = setTimeout(() => scrollToLatest(true), 50);

    return () => {
      clearTimeout(timer);
    };
  }, [latestMessageId]);

  async function continueConversation() {
    setError(null);
    setIsSending(true);
    const afterSequence = lastSequence;

    try {
      const continued = await api.continueConversation(conversation.id, {
        clientMessageId: `ios-${Date.now()}`,
        prompt
      });
      setStatus(continued.status);
      rememberRunningConversation(conversation.id);
      setPrompt("");
      const next = await api.listMessages(conversation.id, afterSequence);
      setMessages((current) => mergeConversationMessages(current, next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to continue Codex");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <FixedScreen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
        style={{ flex: 1, gap: 12 }}
      >
        <Header
          eyebrow="Conversation"
          title={conversation.prompt || "Codex"}
          subtitle="Messages are synced through Abitat Workspace."
        />
        <StatusPill status={status} />

        {isWaitingForMacThread ? (
          <View style={sharedStyles.card}>
            <Text style={sharedStyles.value}>This thread is running on your Mac. Please wait.</Text>
            <Text style={[sharedStyles.subtitle, { marginTop: 8 }]}>
              The phone will unlock this conversation when the Mac Codex run finishes.
            </Text>
          </View>
        ) : (
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
                      backgroundColor:
                        message.role === "user" ? colors.primarySoft : colors.surface,
                      maxWidth: message.role === "user" ? "88%" : "100%"
                    }
                  ]}
                >
                  <Text style={sharedStyles.label}>{message.role}</Text>
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
        )}

        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

        {!isWaitingForMacThread ? (
          <View style={{ gap: 10 }}>
            <TextInput
              multiline
              onChangeText={setPrompt}
              placeholder="Continue this Codex thread"
              placeholderTextColor={colors.muted}
              style={[
                sharedStyles.input,
                { minHeight: 70, paddingTop: 12, textAlignVertical: "top" }
              ]}
              value={prompt}
            />
            <Button
              disabled={isSending || prompt.trim().length === 0}
              onPress={continueConversation}
            >
              {isSending ? "Sending" : "Send"}
            </Button>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </FixedScreen>
  );
}

export function shouldWaitForMacRunningThread(
  conversation: Pick<ConversationSummary, "mobileOpenState" | "source" | "status">
) {
  return (
    conversation.source === "codex_app" &&
    conversation.status === "running" &&
    conversation.mobileOpenState !== "phone_active"
  );
}

export function mergeConversationMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[]
) {
  const byId = new Map<string, ConversationMessage>();

  for (const message of [...current, ...incoming]) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function safeMessageContent(content: string) {
  const maxLength = 8_000;

  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength)}\n\n[Message truncated for iPhone stability.]`;
}
