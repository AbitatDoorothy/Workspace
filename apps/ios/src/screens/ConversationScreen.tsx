import { useEffect, useMemo, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
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
import { Button, StatusPill } from "../components/Controls";
import { rememberRunningConversation } from "../notifications/thread-completion-notifications";
import { FixedScreen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type { ConversationMessage, ConversationSummary } from "../types";

interface ConversationScreenProps {
  api: ApiClient;
  conversation: ConversationSummary;
  onBack(): void;
}

export function ConversationScreen({ api, conversation, onBack }: ConversationScreenProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [prompt, setPrompt] = useState("");
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
    const timer = setInterval(refresh, 1800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, conversation.id]);

  useEffect(() => {
    setError(null);
    setMessages([]);
    setPrompt("");
    setStatus(conversation.status);
    setIsHeaderExpanded(false);
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

        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

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
              disabled={isSending || prompt.trim().length === 0}
              onPress={continueConversation}
            >
              {isSending ? "Sending" : "Send"}
            </Button>
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
  }
});

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
