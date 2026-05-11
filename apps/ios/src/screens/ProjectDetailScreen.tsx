import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ApiClient } from "../api/client";
import { colors } from "../theme";
import type { ConversationSummary, ProjectSummary } from "../types";

interface ProjectDetailScreenProps {
  api: ApiClient;
  initialConversations?: ConversationSummary[];
  onBack(): void;
  onConversation(conversation: ConversationSummary): void;
  onConversationsLoaded?(projectId: string, conversations: ConversationSummary[]): void;
  project: ProjectSummary;
  refreshEnabled?: boolean;
}

const PROJECT_DETAIL_STARS = [
  { left: "3%", opacity: 0.3, size: 1, top: "3%" },
  { left: "25%", opacity: 0.38, size: 2, top: "15%" },
  { left: "49%", opacity: 0.22, size: 1, top: "9%" },
  { left: "77%", opacity: 0.28, size: 1, top: "19%" },
  { left: "10%", opacity: 0.24, size: 1, top: "43%" },
  { left: "68%", opacity: 0.36, size: 2, top: "45%" },
  { left: "94%", opacity: 0.2, size: 1, top: "37%" },
  { left: "4%", opacity: 0.34, size: 1, top: "72%" },
  { left: "24%", opacity: 0.44, size: 2, top: "86%" },
  { left: "50%", opacity: 0.26, size: 1, top: "80%" },
  { left: "83%", opacity: 0.22, size: 1, top: "91%" }
] as const;

export function ProjectDetailScreen({
  api,
  initialConversations = [],
  onBack,
  onConversation,
  onConversationsLoaded,
  project,
  refreshEnabled = true
}: ProjectDetailScreenProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConversations(initialConversations);
  }, [initialConversations, project.id]);

  useEffect(() => {
    if (!refreshEnabled) {
      return;
    }

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
  }, [api, project.id, onConversationsLoaded, refreshEnabled]);

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
    <SafeAreaView edges={["top", "left", "right"]} style={styles.projectScreen}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View pointerEvents="none" style={styles.starField}>
        {PROJECT_DETAIL_STARS.map((star, index) => (
          <View
            key={`project-detail-star-${index}`}
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

      <View style={styles.content}>
        <Pressable
          accessibilityLabel="Back to all projects"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onBack}
          style={({ pressed }) => [
            styles.projectHeader,
            pressed ? styles.projectHeaderPressed : null
          ]}
        >
          <Feather color="#f3f3f3" name="folder" size={29} />
          <Text numberOfLines={1} style={styles.projectName}>
            {project.name}
          </Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Threads</Text>

        <ScrollView
          contentContainerStyle={styles.threadList}
          showsVerticalScrollIndicator={false}
          style={styles.threadScroll}
        >
          {conversations.map((conversation) => {
            const isRunning = isThreadRunningStatus(conversation.status);
            const threadName = conversation.prompt || "Untitled thread";

            return (
              <Pressable
                accessibilityLabel={`Open ${threadName}`}
                accessibilityRole="button"
                key={conversation.id}
                onPress={() => onConversation(conversation)}
                style={({ pressed }) => [
                  styles.threadRow,
                  pressed ? styles.threadRowPressed : null
                ]}
              >
                <View
                  accessibilityLabel={isRunning ? "Thread is running" : "Thread is idle"}
                  style={[
                    styles.threadStatusLight,
                    isRunning ? styles.threadStatusRunning : styles.threadStatusIdle
                  ]}
                />
                <Text numberOfLines={1} style={styles.threadName}>
                  {threadName}
                </Text>
              </Pressable>
            );
          })}

          {conversations.length === 0 && !error ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                No threads have synced for this project yet.
              </Text>
            </View>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>
      </View>

      <View pointerEvents="box-none" style={styles.newThreadDock}>
        <Pressable
          accessibilityLabel="New Thread"
          accessibilityRole="button"
          onPress={startNewThread}
          style={({ pressed }) => [
            styles.newThreadButton,
            pressed ? styles.newThreadButtonPressed : null
          ]}
        >
          <Text style={styles.newThreadButtonText}>New Thread</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingBottom: 126,
    paddingHorizontal: 24,
    paddingTop: 52
  },
  emptyState: {
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    padding: 16
  },
  emptyStateText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    lineHeight: 17
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 12
  },
  newThreadButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.09)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 66,
    paddingHorizontal: 48,
    shadowColor: "#e2e2ff",
    shadowOpacity: 0.12,
    shadowRadius: 20
  },
  newThreadButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }]
  },
  newThreadButtonText: {
    color: "#f5f5f5",
    fontSize: 18,
    fontWeight: "500",
    letterSpacing: 0
  },
  newThreadDock: {
    alignItems: "center",
    bottom: 34,
    left: 0,
    position: "absolute",
    right: 0
  },
  projectHeader: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 22,
    maxWidth: "100%",
    minHeight: 44
  },
  projectHeaderPressed: {
    opacity: 0.68
  },
  projectName: {
    color: "#ffffff",
    flexShrink: 1,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 28
  },
  projectScreen: {
    backgroundColor: "#000000",
    flex: 1
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 24,
    marginTop: 46
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
  threadList: {
    paddingBottom: 18,
    paddingTop: 22
  },
  threadName: {
    color: "#f7f7f7",
    flex: 1,
    fontSize: 18,
    fontWeight: "400",
    letterSpacing: 0,
    lineHeight: 24
  },
  threadRow: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 20,
    minHeight: 88,
    paddingHorizontal: 18
  },
  threadRowPressed: {
    opacity: 0.66,
    transform: [{ scale: 0.99 }]
  },
  threadScroll: {
    flex: 1
  },
  threadStatusIdle: {
    backgroundColor: "#22c55e",
    shadowColor: "#22c55e"
  },
  threadStatusLight: {
    borderRadius: 999,
    height: 13,
    shadowOpacity: 0.72,
    shadowRadius: 12,
    width: 13
  },
  threadStatusRunning: {
    backgroundColor: "#ff4d4d",
    shadowColor: "#ff4d4d"
  }
});

function isThreadRunningStatus(status: string) {
  return ["awaiting_approval", "committing", "preparing", "queued", "running"].includes(status);
}
