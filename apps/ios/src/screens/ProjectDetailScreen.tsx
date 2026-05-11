import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiClient } from "../api/client";
import { Button, Header, StatusPill } from "../components/Controls";
import { Screen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type { ConversationSummary, ProjectSummary } from "../types";

interface ProjectDetailScreenProps {
  api: ApiClient;
  initialConversations?: ConversationSummary[];
  onBack(): void;
  onConversation(conversation: ConversationSummary): void;
  onConversationsLoaded?(projectId: string, conversations: ConversationSummary[]): void;
  project: ProjectSummary;
}

export function ProjectDetailScreen({
  api,
  initialConversations = [],
  onBack,
  onConversation,
  onConversationsLoaded,
  project
}: ProjectDetailScreenProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConversations(initialConversations);
  }, [initialConversations, project.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      try {
        const nextConversations = await api.listConversations(project.id);

        if (!cancelled) {
          setConversations(nextConversations);
          onConversationsLoaded?.(project.id, nextConversations);
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
  }, [api, project.id, onConversationsLoaded]);

  function startNewThread() {
    onConversation({
      id: `draft:${project.id}:${Date.now()}`,
      mobileOpenState: "phone_active",
      projectId: project.id,
      prompt: "",
      source: project.source,
      status: "draft",
      type: "feature",
      workspaceId: project.workspaceId,
      worktreePath: project.hostLocalPath ?? null
    });
  }

  return (
    <Screen>
      <Pressable
        accessibilityLabel="Back to all projects"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.backButtonText}>Projects</Text>
      </Pressable>

      <Header
        eyebrow="Project"
        title={project.name}
        subtitle={project.hostLocalPath ?? project.repoUrl}
      />

      <View style={sharedStyles.card}>
        <Button accessibilityLabel="New Thread" onPress={startNewThread}>
          New Thread
        </Button>
      </View>

      <Text style={sharedStyles.label}>Conversations</Text>
      {conversations.map((conversation) => (
        <Pressable
          key={conversation.id}
          onPress={() => onConversation(conversation)}
          style={sharedStyles.card}
        >
          <Text style={sharedStyles.value} numberOfLines={2}>
            {conversation.prompt || "Untitled conversation"}
          </Text>
          <View style={styles.conversationStatusRow}>
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

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    marginBottom: 14,
    minHeight: 34,
    paddingHorizontal: 12
  },
  backButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  conversationStatusRow: {
    alignItems: "flex-start",
    marginTop: 10
  }
});
