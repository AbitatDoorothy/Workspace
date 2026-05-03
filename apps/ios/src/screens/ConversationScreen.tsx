import { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";

import type { ApiClient } from "../api/client";
import { Button, Header, StatusPill } from "../components/Controls";
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
  const lastSequence = useMemo(
    () => messages.reduce((max, message) => Math.max(max, message.sequence), 0),
    [messages]
  );

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const nextMessages = await api.listMessages(conversation.id);
        if (!cancelled) {
          setMessages(nextMessages);
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

  async function continueConversation() {
    setError(null);

    try {
      const continued = await api.continueConversation(conversation.id, {
        clientMessageId: `ios-${Date.now()}`,
        prompt
      });
      setStatus(continued.status);
      setPrompt("");
      const next = await api.listMessages(conversation.id, lastSequence);
      setMessages((current) => [...current, ...next]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to continue Codex");
    }
  }

  return (
    <FixedScreen>
      <Header
        eyebrow="Conversation"
        title={conversation.prompt || "Codex"}
        subtitle="Messages are synced through Abitat Workspace."
      />
      <StatusPill status={status} />

      <View style={{ flex: 1, gap: 10 }}>
        {messages.map((message) => (
          <View
            key={message.id}
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
              {message.content}
            </Text>
          </View>
        ))}
      </View>

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      <View style={{ gap: 10 }}>
        <TextInput
          multiline
          onChangeText={setPrompt}
          placeholder="Continue this Codex thread"
          placeholderTextColor={colors.muted}
          style={[sharedStyles.input, { minHeight: 70, paddingTop: 12, textAlignVertical: "top" }]}
          value={prompt}
        />
        <Button disabled={prompt.trim().length === 0} onPress={continueConversation}>
          Send
        </Button>
      </View>
    </FixedScreen>
  );
}
