import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { ApiClient } from "../api/client";
import { Button, Header, StatusPill } from "../components/Controls";
import { rememberRunningConversation } from "../notifications/thread-completion-notifications";
import { Screen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type { ConversationSummary, ProjectSummary } from "../types";

interface ProjectDetailScreenProps {
  api: ApiClient;
  onConversation(conversation: ConversationSummary): void;
  project: ProjectSummary;
}

export function ProjectDetailScreen({ api, onConversation, project }: ProjectDetailScreenProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      try {
        const nextConversations = await api.listConversations(project.id);

        if (!cancelled) {
          setConversations(nextConversations);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to load conversations");
        }
      }
    }

    void loadConversations();
    const timer = setInterval(loadConversations, 1800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, project.id]);

  async function startConversation() {
    setError(null);
    setIsStarting(true);

    try {
      const started = await api.createConversation(project.id, {
        clientMessageId: `ios-${Date.now()}`,
        prompt
      });
      rememberRunningConversation(started.conversationId);
      onConversation({
        id: started.conversationId,
        projectId: project.id,
        prompt,
        mobileOpenState: "phone_active",
        source: project.source,
        status: started.status,
        type: "feature",
        workspaceId: project.workspaceId
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start Codex");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <Screen>
      <Header
        eyebrow="Project"
        title={project.name}
        subtitle={project.hostLocalPath ?? project.repoUrl}
      />

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Prompt</Text>
        <TextInput
          multiline
          onChangeText={setPrompt}
          placeholder="Ask Codex to work in this Mac project"
          placeholderTextColor={colors.muted}
          style={[sharedStyles.input, { minHeight: 96, paddingTop: 12, textAlignVertical: "top" }]}
          value={prompt}
        />
        <View style={{ marginTop: 12 }}>
          <Button disabled={isStarting || prompt.trim().length === 0} onPress={startConversation}>
            {isStarting ? "Starting" : "Start Codex"}
          </Button>
        </View>
      </View>

      <Text style={sharedStyles.label}>Conversations</Text>
      {conversations.map((conversation) => (
        <Pressable
          key={conversation.id}
          onPress={() => onConversation(conversation)}
          style={sharedStyles.card}
        >
          <View style={[sharedStyles.row, { justifyContent: "space-between" }]}>
            <Text style={sharedStyles.value} numberOfLines={1}>
              {conversation.prompt || "Untitled conversation"}
            </Text>
            <StatusPill status={conversation.status} />
          </View>
          <Text style={sharedStyles.subtitle}>{conversation.type}</Text>
        </Pressable>
      ))}

      {conversations.length === 0 && !error ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.subtitle}>
            No conversations have synced for this project yet.
          </Text>
        </View>
      ) : null}

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </Screen>
  );
}
