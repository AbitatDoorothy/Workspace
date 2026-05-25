import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  type PanResponderGestureState,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ApiClient } from "../api/client";
import { loadMessageCacheIndex, type MessageCacheIndexEntry } from "../state/message-cache";
import { colors } from "../theme";
import type { ConversationSummary, ProjectSummary } from "../types";

interface ProjectsScreenProps {
  api: ApiClient;
  archivedProjectIds: ReadonlySet<string>;
  initialConversationsByProject?: Record<string, ConversationSummary[]>;
  initialProjects?: ProjectSummary[];
  isConnected: boolean;
  messageCacheScope: string;
  onArchiveProject(projectId: string): void;
  onNewThread(project: ProjectSummary): void;
  onProjectThread(project: ProjectSummary, conversation: ConversationSummary): void;
  onRecoverProject(projectId: string): void;
  onProjectConversationsLoaded?(projectId: string, conversations: ConversationSummary[]): void;
  onProjectsLoaded?(projects: ProjectSummary[]): void;
  onSettings(): void;
  refreshEnabled?: boolean;
}

type ThreadAttentionTone = "idle" | "running" | "unread";

const ARCHIVE_PROJECT_ID = "archive";
const PROJECT_ARCHIVE_SWIPE_DISTANCE = 64;
const PROJECT_ARCHIVE_EXIT_DISTANCE = 420;
const PROJECT_ARCHIVE_SWIPE_VERTICAL_TOLERANCE = 56;

const CELESTIAL_STARS = [
  { left: "4%", opacity: 0.22, size: 1, top: "8%" },
  { left: "14%", opacity: 0.38, size: 1.5, top: "24%" },
  { left: "28%", opacity: 0.24, size: 1, top: "6%" },
  { left: "42%", opacity: 0.32, size: 1, top: "16%" },
  { left: "58%", opacity: 0.18, size: 1, top: "5%" },
  { left: "74%", opacity: 0.34, size: 1.5, top: "12%" },
  { left: "88%", opacity: 0.2, size: 1, top: "20%" },
  { left: "10%", opacity: 0.3, size: 1, top: "34%" },
  { left: "31%", opacity: 0.5, size: 2, top: "30%" },
  { left: "50%", opacity: 0.28, size: 1, top: "38%" },
  { left: "67%", opacity: 0.34, size: 1.5, top: "32%" },
  { left: "91%", opacity: 0.42, size: 1, top: "37%" },
  { left: "6%", opacity: 0.2, size: 1, top: "48%" },
  { left: "22%", opacity: 0.38, size: 1.5, top: "54%" },
  { left: "39%", opacity: 0.28, size: 1, top: "50%" },
  { left: "59%", opacity: 0.24, size: 1, top: "58%" },
  { left: "82%", opacity: 0.36, size: 1.5, top: "52%" },
  { left: "96%", opacity: 0.22, size: 1, top: "61%" },
  { left: "13%", opacity: 0.3, size: 1, top: "70%" },
  { left: "34%", opacity: 0.2, size: 1, top: "76%" },
  { left: "53%", opacity: 0.38, size: 1.5, top: "72%" },
  { left: "71%", opacity: 0.24, size: 1, top: "80%" },
  { left: "90%", opacity: 0.36, size: 2, top: "75%" },
  { left: "8%", opacity: 0.28, size: 1, top: "88%" },
  { left: "26%", opacity: 0.42, size: 1.5, top: "94%" },
  { left: "46%", opacity: 0.22, size: 1, top: "90%" },
  { left: "64%", opacity: 0.28, size: 1, top: "96%" },
  { left: "86%", opacity: 0.2, size: 1, top: "91%" }
] as const;

const BIG_DIPPER_STARS = [
  { left: "59%", top: "24%" },
  { left: "64%", top: "27%" },
  { left: "69%", top: "31%" },
  { left: "75%", top: "37%" },
  { left: "73%", top: "45%" },
  { left: "82%", top: "48%" },
  { left: "85%", top: "40%" }
] as const;

export function ProjectsScreen({
  api,
  archivedProjectIds,
  initialConversationsByProject = {},
  initialProjects = [],
  isConnected,
  messageCacheScope,
  onArchiveProject,
  onNewThread,
  onProjectThread,
  onRecoverProject,
  onProjectConversationsLoaded,
  onProjectsLoaded,
  onSettings,
  refreshEnabled = true
}: ProjectsScreenProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjects);
  const [conversationsByProject, setConversationsByProject] = useState<
    Record<string, ConversationSummary[]>
  >(initialConversationsByProject);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [expandedArchivedProjectIds, setExpandedArchivedProjectIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isArchiveExpanded, setIsArchiveExpanded] = useState(false);
  const [isProjectSwipeActive, setIsProjectSwipeActive] = useState(false);
  const [loadingProjectIds, setLoadingProjectIds] = useState<Set<string>>(() => new Set());
  const [messageCacheIndex, setMessageCacheIndex] = useState<MessageCacheIndexEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversationRefreshInFlightProjectIdsRef = useRef(new Set<string>());
  const visibleProjects = projects.filter((project) => !archivedProjectIds.has(project.id));
  const archivedProjects = projects.filter((project) => archivedProjectIds.has(project.id));
  const projectThreadRefreshIdsKey = projects.map((project) => project.id).join("\u0001");

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  useEffect(() => {
    setConversationsByProject(initialConversationsByProject);
  }, [initialConversationsByProject]);

  useEffect(() => {
    if (!refreshEnabled) {
      return;
    }

    let cancelled = false;

    async function loadReadState() {
      try {
        const entries = await loadMessageCacheIndex(messageCacheScope);
        if (!cancelled) {
          setMessageCacheIndex(entries);
        }
      } catch (caught) {
        console.warn(`[message-cache] unable to load project read state: ${errorMessage(caught)}`);
      }
    }

    void loadReadState();
    const timer = setInterval(loadReadState, 3500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [messageCacheScope, refreshEnabled]);

  const loadProjectConversations = useCallback(
    async (projectId: string) => {
      if (conversationRefreshInFlightProjectIdsRef.current.has(projectId)) {
        return;
      }

      conversationRefreshInFlightProjectIdsRef.current.add(projectId);
      setLoadingProjectIds((current) => new Set(current).add(projectId));
      try {
        const conversations = await api.listConversations(projectId);
        setConversationsByProject((current) => ({
          ...current,
          [projectId]: conversations
        }));
        onProjectConversationsLoaded?.(projectId, conversations);
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to load project threads");
      } finally {
        conversationRefreshInFlightProjectIdsRef.current.delete(projectId);
        setLoadingProjectIds((current) => {
          const next = new Set(current);
          next.delete(projectId);
          return next;
        });
      }
    },
    [api, onProjectConversationsLoaded]
  );

  useEffect(() => {
    if (!refreshEnabled) {
      return;
    }

    let cancelled = false;

    async function loadProjects() {
      try {
        const nextProjects = await api.listProjects();

        if (!cancelled) {
          setProjects(nextProjects);
          onProjectsLoaded?.(nextProjects);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to load projects");
        }
      }
    }

    void loadProjects();
    const timer = setInterval(loadProjects, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, onProjectsLoaded, refreshEnabled]);

  useEffect(() => {
    const projectIds = projectThreadRefreshIdsKey ? projectThreadRefreshIdsKey.split("\u0001") : [];
    if (!refreshEnabled || projectIds.length === 0) {
      return;
    }

    function loadVisibleProjectConversations() {
      for (const projectId of projectIds) {
        void loadProjectConversations(projectId);
      }
    }

    loadVisibleProjectConversations();
    const timer = setInterval(loadVisibleProjectConversations, 5000);

    return () => clearInterval(timer);
  }, [loadProjectConversations, projectThreadRefreshIdsKey, refreshEnabled]);

  function toggleProjectFold(projectId: string) {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  function toggleArchivedProjectFold(projectId: string) {
    setExpandedArchivedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  function recoverArchivedProject(projectId: string) {
    setExpandedArchivedProjectIds((current) => {
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    onRecoverProject(projectId);
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.voidScreen}>
      <StatusBar barStyle="light-content" />
      <View pointerEvents="none" style={styles.starField}>
        {CELESTIAL_STARS.map((star, index) => (
          <View
            key={`star-${star.left}-${star.top}-${index}`}
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
        {BIG_DIPPER_STARS.map((star, index) => (
          <View
            key={`dipper-${star.left}-${star.top}-${index}`}
            style={[styles.constellationStar, { left: star.left, top: star.top }]}
          />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        directionalLockEnabled
        scrollEnabled={!isProjectSwipeActive}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <View style={styles.headerRow}>
          <Text accessibilityRole="header" style={styles.brand}>
            ABITAT
          </Text>
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            hitSlop={12}
            onPress={onSettings}
            style={({ pressed }) => [
              styles.settingsButton,
              pressed ? styles.settingsButtonPressed : null
            ]}
          >
            <Feather
              color={isConnected ? "#ffffff" : "rgba(255,255,255,0.36)"}
              name="grid"
              size={19}
            />
          </Pressable>
        </View>

        <View style={styles.projectsSection}>
          <Text style={styles.sectionTitle}>PROJECTS</Text>
          <View style={styles.projectList}>
            {visibleProjects.map((project) => {
              const projectConversations = conversationsForProject(project, conversationsByProject);
              const isLoadingProject = loadingProjectIds.has(project.id);
              const projectThreadsCollapsed = collapsedProjectIds.has(project.id);

              return (
                <View key={project.id} style={styles.projectGroup}>
                  <ProjectSwipeRow
                    accessibilityLabel={`${projectThreadsCollapsed ? "Expand" : "Fold"} ${project.name} threads`}
                    accessibilityState={{ expanded: !projectThreadsCollapsed }}
                    onArchive={() => onArchiveProject(project.id)}
                    onPress={() => toggleProjectFold(project.id)}
                    onSwipeActiveChange={setIsProjectSwipeActive}
                  >
                    <Feather name="folder" size={24} color="#f2f2f2" />
                    <Text numberOfLines={1} style={styles.projectName}>
                      {project.name}
                    </Text>
                    <Pressable
                      accessibilityLabel={`Create thread in ${project.name}`}
                      accessibilityRole="button"
                      hitSlop={10}
                      onPress={(event) => {
                        event.stopPropagation();
                        onNewThread(project);
                      }}
                      style={({ pressed }) => [
                        styles.projectNewThreadButton,
                        pressed ? styles.projectNewThreadButtonPressed : null
                      ]}
                    >
                      <Feather color="rgba(255,255,255,0.84)" name="plus" size={19} />
                    </Pressable>
                  </ProjectSwipeRow>

                  {!projectThreadsCollapsed ? (
                    <ProjectThreadList
                      isLoadingProject={isLoadingProject}
                      messageCacheIndex={messageCacheIndex}
                      onProjectThread={onProjectThread}
                      project={project}
                      projectConversations={projectConversations}
                    />
                  ) : null}
                </View>
              );
            })}
            <View key={ARCHIVE_PROJECT_ID} style={styles.projectGroup}>
              <Pressable
                accessibilityLabel="Toggle archive projects"
                accessibilityRole="button"
                accessibilityState={{ expanded: isArchiveExpanded }}
                onPress={() => setIsArchiveExpanded((current) => !current)}
                style={({ pressed }) => [
                  styles.projectRow,
                  pressed ? styles.projectRowPressed : null
                ]}
              >
                <Feather name="archive" size={24} color="#d1d5db" />
                <Text numberOfLines={1} style={styles.projectName}>
                  ARCHIVE
                </Text>
              </Pressable>

              {isArchiveExpanded ? (
                <View style={styles.archivedProjectList}>
                  {archivedProjects.length > 0 ? (
                    archivedProjects.map((project) => {
                      const projectConversations = conversationsForProject(
                        project,
                        conversationsByProject
                      );
                      const isLoadingProject = loadingProjectIds.has(project.id);
                      const archivedProjectThreadsExpanded = expandedArchivedProjectIds.has(
                        project.id
                      );

                      return (
                        <View key={project.id} style={styles.archivedProjectGroup}>
                          <Pressable
                            accessibilityLabel={`${
                              archivedProjectThreadsExpanded ? "Fold" : "Expand"
                            } archived ${project.name} threads`}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: archivedProjectThreadsExpanded }}
                            onPress={() => toggleArchivedProjectFold(project.id)}
                            style={({ pressed }) => [
                              styles.archivedProjectRow,
                              pressed ? styles.projectThreadRowPressed : null
                            ]}
                          >
                            <Feather color="rgba(255,255,255,0.66)" name="folder" size={15} />
                            <Text numberOfLines={1} style={styles.projectThreadName}>
                              {project.name}
                            </Text>
                            <Pressable
                              accessibilityLabel={`Recover ${project.name} from archive`}
                              accessibilityRole="button"
                              hitSlop={10}
                              onPress={(event) => {
                                event.stopPropagation();
                                recoverArchivedProject(project.id);
                              }}
                              style={({ pressed }) => [
                                styles.projectRecoverButton,
                                pressed ? styles.projectRecoverButtonPressed : null
                              ]}
                            >
                              <Feather color="rgba(255,255,255,0.76)" name="rotate-ccw" size={15} />
                            </Pressable>
                          </Pressable>
                          {archivedProjectThreadsExpanded ? (
                            <ProjectThreadList
                              isLoadingProject={isLoadingProject}
                              messageCacheIndex={messageCacheIndex}
                              onProjectThread={onProjectThread}
                              project={project}
                              projectConversations={projectConversations}
                            />
                          ) : null}
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.projectThreadEmptyText}>NO ARCHIVED PROJECTS</Text>
                  )}
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {projects.length === 0 && !error ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No projects are available yet.</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 30
  },
  constellationStar: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    height: 4,
    opacity: 0.96,
    position: "absolute",
    shadowColor: "#ffffff",
    shadowOpacity: 0.72,
    shadowRadius: 7,
    width: 4
  },
  content: {
    minHeight: "100%",
    paddingBottom: 96,
    paddingHorizontal: 24,
    paddingTop: 28
  },
  emptyState: {
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 30,
    padding: 16
  },
  emptyStateText: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 13,
    lineHeight: 18
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 24
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  projectList: {
    gap: 18
  },
  projectName: {
    color: "#f7f7f7",
    flex: 1,
    fontSize: 20,
    fontWeight: "400",
    letterSpacing: 0,
    lineHeight: 27
  },
  projectNewThreadButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  projectNewThreadButtonPressed: {
    opacity: 0.62,
    transform: [{ scale: 0.94 }]
  },
  projectRecoverButton: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28
  },
  projectRecoverButtonPressed: {
    opacity: 0.62,
    transform: [{ scale: 0.94 }]
  },
  projectGroup: {
    gap: 10
  },
  projectRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    minHeight: 32
  },
  projectRowPressed: {
    opacity: 0.62,
    transform: [{ scale: 0.99 }]
  },
  projectSwipeArchiveHint: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    position: "absolute",
    right: 0,
    top: 0,
    width: 74
  },
  projectSwipeBand: {
    backgroundColor: "#000000"
  },
  projectSwipeShell: {
    overflow: "hidden"
  },
  threadStatusRunning: {
    backgroundColor: "#ff4d4d",
    shadowColor: "#ff4d4d"
  },
  threadStatusUnread: {
    backgroundColor: "#38bdf8",
    shadowColor: "#38bdf8"
  },
  projectsSection: {
    gap: 24,
    marginTop: 38
  },
  scroll: {
    flex: 1
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 20
  },
  settingsButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  settingsButtonPressed: {
    opacity: 0.62,
    transform: [{ scale: 0.98 }]
  },
  archivedProjectGroup: {
    gap: 8
  },
  archivedProjectList: {
    gap: 16,
    marginLeft: 33,
    paddingLeft: 20,
    paddingVertical: 2
  },
  projectThreadEmptyText: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    lineHeight: 14
  },
  projectThreadList: {
    borderLeftColor: "rgba(255,255,255,0.1)",
    borderLeftWidth: 1,
    gap: 8,
    marginLeft: 33,
    paddingLeft: 20,
    paddingVertical: 2
  },
  projectThreadName: {
    color: "rgba(255,255,255,0.78)",
    flex: 1,
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 0,
    lineHeight: 17
  },
  projectThreadRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 24
  },
  archivedProjectRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 28
  },
  projectThreadRowPressed: {
    opacity: 0.64,
    transform: [{ scale: 0.99 }]
  },
  projectThreadStatusLight: {
    borderRadius: 999,
    height: 8,
    shadowOpacity: 0.72,
    shadowRadius: 8,
    width: 8
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
  voidScreen: {
    backgroundColor: "#000000",
    flex: 1
  }
});

function ProjectSwipeRow({
  accessibilityLabel,
  accessibilityState,
  children,
  onArchive,
  onPress,
  onSwipeActiveChange
}: {
  accessibilityLabel: string;
  accessibilityState: { expanded: boolean };
  children: ReactNode;
  onArchive(): void;
  onPress(): void;
  onSwipeActiveChange(active: boolean): void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isSwipeResponderRef = useRef(false);
  const opacity = translateX.interpolate({
    extrapolate: "clamp",
    inputRange: [-PROJECT_ARCHIVE_EXIT_DISTANCE, -PROJECT_ARCHIVE_SWIPE_DISTANCE, 0],
    outputRange: [0, 0.9, 1]
  });
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => shouldHandleArchiveSwipe(gesture),
      onMoveShouldSetPanResponderCapture: (_event, gesture) => shouldHandleArchiveSwipe(gesture),
      onPanResponderGrant: () => {
        isSwipeResponderRef.current = true;
        onSwipeActiveChange(true);
        translateX.stopAnimation();
      },
      onPanResponderMove: (_event, gesture) => {
        translateX.setValue(Math.min(0, Math.max(-PROJECT_ARCHIVE_EXIT_DISTANCE, gesture.dx)));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (
          gesture.dx <= -PROJECT_ARCHIVE_SWIPE_DISTANCE &&
          Math.abs(gesture.dy) <= PROJECT_ARCHIVE_SWIPE_VERTICAL_TOLERANCE
        ) {
          Animated.timing(translateX, {
            duration: 220,
            easing: Easing.in(Easing.cubic),
            toValue: -PROJECT_ARCHIVE_EXIT_DISTANCE,
            useNativeDriver: true
          }).start(({ finished }) => {
            if (finished) {
              isSwipeResponderRef.current = false;
              onSwipeActiveChange(false);
              onArchive();
            } else {
              resetProjectSwipe(translateX, isSwipeResponderRef, onSwipeActiveChange);
            }
          });
          return;
        }

        resetProjectSwipe(translateX, isSwipeResponderRef, onSwipeActiveChange);
      },
      onPanResponderTerminate: () => {
        resetProjectSwipe(translateX, isSwipeResponderRef, onSwipeActiveChange);
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true
    })
  ).current;

  return (
    <View style={styles.projectSwipeShell}>
      <View pointerEvents="none" style={styles.projectSwipeArchiveHint}>
        <Feather color="rgba(255,255,255,0.46)" name="archive" size={17} />
      </View>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.projectSwipeBand,
          {
            opacity,
            transform: [{ translateX }]
          }
        ]}
      >
        <Pressable
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          onPress={() => {
            if (isSwipeResponderRef.current) {
              return;
            }

            onPress();
          }}
          style={({ pressed }) => [styles.projectRow, pressed ? styles.projectRowPressed : null]}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

function ProjectThreadList({
  isLoadingProject,
  messageCacheIndex,
  onProjectThread,
  project,
  projectConversations
}: {
  isLoadingProject: boolean;
  messageCacheIndex: MessageCacheIndexEntry[];
  onProjectThread(project: ProjectSummary, conversation: ConversationSummary): void;
  project: ProjectSummary;
  projectConversations: ConversationSummary[];
}) {
  return (
    <View style={styles.projectThreadList}>
      {isLoadingProject && projectConversations.length === 0 ? (
        <Text style={styles.projectThreadEmptyText}>SYNCING THREADS</Text>
      ) : projectConversations.length > 0 ? (
        projectConversations.map((conversation) => {
          const threadTone = threadStatusTone(conversation, messageCacheIndex);
          return (
            <Pressable
              accessibilityLabel={`Open ${conversation.prompt || "Untitled thread"}`}
              accessibilityRole="button"
              key={conversation.id}
              onPress={() => onProjectThread(project, conversation)}
              style={({ pressed }) => [
                styles.projectThreadRow,
                pressed ? styles.projectThreadRowPressed : null
              ]}
            >
              {threadTone !== "idle" ? (
                <View
                  accessibilityLabel={threadStatusAccessibilityLabel(threadTone)}
                  style={[
                    styles.projectThreadStatusLight,
                    threadTone === "running"
                      ? styles.threadStatusRunning
                      : styles.threadStatusUnread
                  ]}
                />
              ) : null}
              <Text numberOfLines={1} style={styles.projectThreadName}>
                {conversation.prompt || "Untitled thread"}
              </Text>
            </Pressable>
          );
        })
      ) : (
        <Text style={styles.projectThreadEmptyText}>NO THREADS</Text>
      )}
    </View>
  );
}

function shouldHandleArchiveSwipe(gesture: PanResponderGestureState) {
  return (
    gesture.dx < -4 &&
    Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.05 &&
    Math.abs(gesture.dy) <= PROJECT_ARCHIVE_SWIPE_VERTICAL_TOLERANCE
  );
}

function resetProjectSwipe(
  translateX: Animated.Value,
  isSwipeResponderRef: { current: boolean },
  onSwipeActiveChange: (active: boolean) => void
) {
  Animated.spring(translateX, {
    friction: 18,
    tension: 170,
    toValue: 0,
    useNativeDriver: true
  }).start(() => {
    isSwipeResponderRef.current = false;
    onSwipeActiveChange(false);
  });
}

function conversationsForProject(
  project: ProjectSummary,
  conversationsByProject: Record<string, ConversationSummary[]>
) {
  const byId = new Map<string, ConversationSummary>();

  for (const conversation of conversationsByProject[project.id] ?? []) {
    byId.set(conversation.id, conversation);
  }

  return [...byId.values()].sort((left, right) =>
    (right.updatedAt ?? right.createdAt ?? "").localeCompare(left.updatedAt ?? left.createdAt ?? "")
  );
}

function threadStatusTone(
  conversation: ConversationSummary,
  messageCacheIndex: MessageCacheIndexEntry[]
): ThreadAttentionTone {
  if (isThreadRunningStatus(conversation.status)) {
    return "running";
  }

  return isConversationUnread(conversation.id, messageCacheIndex) ? "unread" : "idle";
}

function isThreadRunningStatus(status: string) {
  return ["awaiting_approval", "committing", "preparing", "queued", "running"].includes(status);
}

function isConversationUnread(conversationId: string, messageCacheIndex: MessageCacheIndexEntry[]) {
  const entry = messageCacheIndex.find((candidate) => candidate.conversationId === conversationId);
  return Boolean(entry && entry.latestSequence > (entry.lastReadSequence ?? 0));
}

function threadStatusAccessibilityLabel(tone: Exclude<ThreadAttentionTone, "idle">) {
  if (tone === "running") {
    return "Thread is running";
  }

  return "Thread has unread messages";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
