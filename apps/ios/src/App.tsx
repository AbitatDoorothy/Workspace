import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { PairingScreen } from "./screens/PairingScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { ProjectDetailScreen } from "./screens/ProjectDetailScreen";
import { ConversationScreen } from "./screens/ConversationScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import {
  type CodexCompletionNotificationTarget,
  useThreadCompletionNotifications
} from "./notifications/thread-completion-notifications";
import { useMobileStore } from "./state/mobile-store";
import { colors } from "./theme";
import type { ConversationSummary, ProjectSummary, RouteName } from "./types";

type RootRouteName = Extract<RouteName, "workspace" | "projects" | "settings">;
type IoniconName = ComponentProps<typeof Ionicons>["name"];

const NAV_ITEMS: Array<{
  activeIcon: IoniconName;
  icon: IoniconName;
  label: string;
  route: RootRouteName;
}> = [
  {
    activeIcon: "laptop",
    icon: "laptop-outline",
    label: "Workspace",
    route: "workspace"
  },
  {
    activeIcon: "folder",
    icon: "folder-outline",
    label: "Projects",
    route: "projects"
  },
  {
    activeIcon: "settings",
    icon: "settings-outline",
    label: "Settings",
    route: "settings"
  }
];

export default function App() {
  const store = useMobileStore();
  const [route, setRoute] = useState<RouteName>("workspace");
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [cachedProjects, setCachedProjects] = useState<ProjectSummary[]>([]);
  const [cachedConversationsByProject, setCachedConversationsByProject] = useState<
    Record<string, ConversationSummary[]>
  >({});
  const shouldShowBottomNav = route !== "conversation";
  const openConversationFromNotification = useCallback(
    async (target: CodexCompletionNotificationTarget) => {
      const api = store.api;
      let projects: ProjectSummary[] = [];

      try {
        projects = await api.listProjects();
      } catch (caught) {
        console.warn(
          `[notifications] Unable to load projects before opening ${target.conversationId}: ${errorMessage(
            caught
          )}`
        );
      }

      const nextProject =
        projects.find((candidate) => candidate.id === target.projectId) ??
        fallbackProjectFromNotification(target, store.pairing?.workspaceId ?? "");

      let conversations: ConversationSummary[] = [];
      try {
        conversations = await api.listConversations(target.projectId);
      } catch (caught) {
        console.warn(
          `[notifications] Unable to load conversations before opening ${
            target.conversationId
          }: ${errorMessage(caught)}`
        );
      }

      const nextConversation =
        conversations.find((candidate) => candidate.id === target.conversationId) ??
        fallbackConversationFromNotification(target, nextProject);

      setProject(nextProject);
      setConversation(nextConversation);
      setRoute("conversation");
    },
    [store.api, store.pairing?.workspaceId]
  );
  const updateCachedConversations = useCallback(
    (projectId: string, nextConversations: ConversationSummary[]) => {
      setCachedConversationsByProject((current) => ({
        ...current,
        [projectId]: nextConversations
      }));
    },
    []
  );
  useThreadCompletionNotifications(store.api, store.isPaired, openConversationFromNotification);

  if (store.isRestoring) {
    return (
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.canvas,
          flex: 1,
          justifyContent: "center"
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!store.isPaired) {
    return (
      <PairingScreen
        api={store.api}
        apiUrl={store.apiUrl}
        onApiUrlChange={store.setApiUrl}
        onPaired={(pairing) => {
          void store.savePairing(pairing);
          setRoute("workspace");
        }}
      />
    );
  }

  return (
    <View style={{ backgroundColor: colors.canvas, flex: 1 }}>
      {route === "workspace" ? (
        <WorkspaceScreen
          bootstrap={store.bootstrap}
          error={store.bootstrapError}
          onNavigate={setRoute}
        />
      ) : null}
      {route === "projects" ? (
        <ProjectsScreen
          api={store.api}
          initialProjects={cachedProjects}
          onProjectsLoaded={setCachedProjects}
          onProject={(nextProject) => {
            setProject(nextProject);
            setRoute("project");
          }}
        />
      ) : null}
      {route === "project" && project ? (
        <ProjectDetailScreen
          api={store.api}
          initialConversations={cachedConversationsByProject[project.id] ?? []}
          onBack={() => setRoute("projects")}
          onConversation={(nextConversation) => {
            setConversation(nextConversation);
            setRoute("conversation");
          }}
          onConversationsLoaded={updateCachedConversations}
          project={project}
        />
      ) : null}
      {route === "conversation" && conversation ? (
        <ConversationScreen
          api={store.api}
          conversation={conversation}
          messageCacheScope={store.messageCacheScope}
          modelSettings={store.modelSettings}
          onBack={() => setRoute(project ? "project" : "projects")}
          onModelSettingsChange={store.saveModelSettings}
        />
      ) : null}
      {route === "settings" ? (
        <SettingsScreen
          onSignOut={() => {
            void store.signOut();
            setRoute("workspace");
          }}
          pairing={store.pairing}
        />
      ) : null}

      {shouldShowBottomNav ? (
        <View style={styles.bottomNav}>
          {NAV_ITEMS.map((item) => {
            const isActive = route === item.route;

            return (
              <Pressable
                accessibilityLabel={item.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                key={item.route}
                onPress={() => setRoute(item.route)}
                style={({ pressed }) => [
                  styles.bottomNavItem,
                  isActive && styles.bottomNavItemActive,
                  pressed && styles.bottomNavItemPressed
                ]}
              >
                <Ionicons
                  color={isActive ? colors.primary : colors.muted}
                  name={isActive ? item.activeIcon : item.icon}
                  size={26}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNav: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    paddingBottom: 18,
    paddingHorizontal: 22,
    paddingTop: 8
  },
  bottomNavItem: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 44
  },
  bottomNavItemActive: {
    backgroundColor: colors.primarySoft
  },
  bottomNavItemPressed: {
    opacity: 0.72
  }
});

function fallbackProjectFromNotification(
  target: CodexCompletionNotificationTarget,
  workspaceId: string
): ProjectSummary {
  return {
    id: target.projectId,
    name: target.projectName ?? "Codex Project",
    repoSyncStatus: "unknown",
    repoUrl: "",
    source: "codex_app",
    workspaceId: target.workspaceId ?? workspaceId
  };
}

function fallbackConversationFromNotification(
  target: CodexCompletionNotificationTarget,
  project: ProjectSummary
): ConversationSummary {
  return {
    id: target.conversationId,
    mobileOpenState: "ready",
    projectId: target.projectId,
    prompt: target.prompt ?? "Codex thread",
    source: "codex_app",
    status: target.status ?? "approved",
    type: "codex_app",
    workspaceId: target.workspaceId ?? project.workspaceId,
    worktreePath: project.hostLocalPath ?? null
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
