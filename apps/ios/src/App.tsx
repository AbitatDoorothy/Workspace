import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, PanResponder, View } from "react-native";

import { PairingScreen } from "./screens/PairingScreen";
import { SplashScreen } from "./screens/SplashScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { ProjectDetailScreen } from "./screens/ProjectDetailScreen";
import { ConversationScreen } from "./screens/ConversationScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import {
  type CodexCompletionNotificationTarget,
  useThreadCompletionNotifications
} from "./notifications/thread-completion-notifications";
import { useMessagePreloader } from "./state/message-preloader";
import { useMobileStore } from "./state/mobile-store";
import { colors } from "./theme";
import type { ConversationSummary, ProjectSummary, RouteName } from "./types";

const GLOBAL_BACK_SWIPE_DISTANCE = 70;
const GLOBAL_BACK_SWIPE_VERTICAL_TOLERANCE = 60;

export default function App() {
  const store = useMobileStore();
  const [hasStarted, setHasStarted] = useState(false);
  const [route, setRoute] = useState<RouteName>("projects");
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [cachedProjects, setCachedProjects] = useState<ProjectSummary[]>([]);
  const [cachedConversationsByProject, setCachedConversationsByProject] = useState<
    Record<string, ConversationSummary[]>
  >({});
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
  const goBackOneLevel = useCallback(() => {
    setRoute((currentRoute) => routeBackOneLevel(currentRoute, project));
  }, [project]);
  const globalBackSwipeResponder = useMemo(
    () => createGlobalBackSwipeResponder(goBackOneLevel),
    [goBackOneLevel]
  );
  useThreadCompletionNotifications(store.api, store.isPaired, openConversationFromNotification);
  useMessagePreloader({
    api: store.api,
    enabled: store.isPaired,
    messageCacheScope: store.messageCacheScope
  });

  if (!hasStarted) {
    return <SplashScreen onStart={() => setHasStarted(true)} />;
  }

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
          setRoute("projects");
        }}
      />
    );
  }

  return (
    <View
      style={{ backgroundColor: colors.canvas, flex: 1 }}
      {...globalBackSwipeResponder.panHandlers}
    >
      {route === "projects" ? (
        <ProjectsScreen
          api={store.api}
          initialProjects={cachedProjects}
          onProjectsLoaded={setCachedProjects}
          onProject={(nextProject) => {
            setProject(nextProject);
            setRoute("project");
          }}
          onSettings={() => setRoute("settings")}
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
          bootstrap={store.bootstrap}
          error={store.bootstrapError}
          onBack={() => setRoute("projects")}
          onSignOut={() => {
            void store.signOut();
            setRoute("projects");
          }}
          pairing={store.pairing}
        />
      ) : null}
    </View>
  );
}

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

function routeBackOneLevel(route: RouteName, project: ProjectSummary | null): RouteName {
  if (route === "conversation") {
    return project ? "project" : "projects";
  }

  if (route === "project" || route === "settings" || route === "workspace") {
    return "projects";
  }

  return route;
}

function createGlobalBackSwipeResponder(onBack: () => void) {
  return PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => shouldStartGlobalBackSwipe(gesture),
    onMoveShouldSetPanResponderCapture: (_event, gesture) => shouldStartGlobalBackSwipe(gesture),
    onPanResponderRelease: (_event, gesture) => {
      if (
        gesture.dx >= GLOBAL_BACK_SWIPE_DISTANCE &&
        Math.abs(gesture.dy) <= GLOBAL_BACK_SWIPE_VERTICAL_TOLERANCE
      ) {
        onBack();
      }
    }
  });
}

function shouldStartGlobalBackSwipe(gesture: { dx: number; dy: number }) {
  return gesture.dx > 18 && Math.abs(gesture.dy) < 36;
}
