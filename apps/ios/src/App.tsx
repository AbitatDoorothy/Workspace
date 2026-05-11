import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

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
const GLOBAL_BACK_SWIPE_DISMISS_DURATION_MS = 180;
const GLOBAL_BACK_SWIPE_OVERSHOOT = 24;
const FORWARD_ROUTE_SLIDE_DURATION_MS = 220;

interface NavigationRouteLayer {
  layerKey: string;
  routeName: RouteName;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const store = useMobileStore();
  const { width: windowWidth } = useWindowDimensions();
  const routeLayerSequenceRef = useRef(0);
  const createRouteLayerKey = useCallback((routeName: RouteName) => {
    routeLayerSequenceRef.current += 1;
    return `route-${routeName}-${routeLayerSequenceRef.current}`;
  }, []);
  const [hasStarted, setHasStarted] = useState(false);
  const [route, setRoute] = useState<RouteName>("projects");
  const [activeRouteLayerKey, setActiveRouteLayerKey] = useState("route-projects-0");
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [forwardRoute, setForwardRoute] = useState<NavigationRouteLayer | null>(null);
  const [swipeBackPreviewRoute, setSwipeBackPreviewRoute] = useState<NavigationRouteLayer | null>(
    null
  );
  const backSwipeX = useRef(new Animated.Value(0)).current;
  const forwardSlideX = useRef(new Animated.Value(0)).current;
  const swipeBackTargetRef = useRef<NavigationRouteLayer | null>(null);
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
  const navigateToRoute = useCallback(
    (nextRoute: RouteName) => {
      if (nextRoute === route) {
        return;
      }

      backSwipeX.stopAnimation();
      forwardSlideX.stopAnimation();
      const nextForwardRoute = {
        layerKey: createRouteLayerKey(nextRoute),
        routeName: nextRoute
      };
      swipeBackTargetRef.current = null;
      setSwipeBackPreviewRoute(null);
      forwardSlideX.setValue(windowWidth + GLOBAL_BACK_SWIPE_OVERSHOOT);
      setForwardRoute(nextForwardRoute);

      Animated.timing(forwardSlideX, {
        duration: FORWARD_ROUTE_SLIDE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true
      }).start(({ finished }) => {
        if (finished) {
          setRoute(nextForwardRoute.routeName);
          setActiveRouteLayerKey(nextForwardRoute.layerKey);
          setForwardRoute((currentRoute) =>
            currentRoute?.layerKey === nextForwardRoute.layerKey ? null : currentRoute
          );
          forwardSlideX.setValue(0);
        }
      });
    },
    [backSwipeX, createRouteLayerKey, forwardSlideX, route, windowWidth]
  );
  const beginBackSwipe = useCallback(() => {
    const targetRoute = routeBackOneLevel(route, project);
    if (targetRoute === route) {
      return false;
    }

    const nextBackRoute = {
      layerKey: createRouteLayerKey(targetRoute),
      routeName: targetRoute
    };
    backSwipeX.stopAnimation();
    forwardSlideX.stopAnimation();
    setForwardRoute(null);
    backSwipeX.setValue(0);
    swipeBackTargetRef.current = nextBackRoute;
    setSwipeBackPreviewRoute(nextBackRoute);
    return true;
  }, [backSwipeX, createRouteLayerKey, forwardSlideX, project, route]);
  const moveBackSwipe = useCallback(
    (distance: number) => {
      if (!swipeBackTargetRef.current) {
        return;
      }

      backSwipeX.setValue(clampSwipeDistance(distance, windowWidth));
    },
    [backSwipeX, windowWidth]
  );
  const cancelBackSwipe = useCallback(() => {
    Animated.spring(backSwipeX, {
      friction: 18,
      tension: 140,
      toValue: 0,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) {
        swipeBackTargetRef.current = null;
        setSwipeBackPreviewRoute(null);
      }
    });
  }, [backSwipeX]);
  const commitBackSwipe = useCallback(() => {
    const targetRoute = swipeBackTargetRef.current;
    if (!targetRoute) {
      return;
    }

    Animated.timing(backSwipeX, {
      duration: GLOBAL_BACK_SWIPE_DISMISS_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      toValue: windowWidth + GLOBAL_BACK_SWIPE_OVERSHOOT,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (!finished) {
        return;
      }

      setRoute(targetRoute.routeName);
      setActiveRouteLayerKey(targetRoute.layerKey);
      swipeBackTargetRef.current = null;
      setSwipeBackPreviewRoute((currentRoute) =>
        currentRoute?.layerKey === targetRoute.layerKey ? null : currentRoute
      );
    });
  }, [backSwipeX, windowWidth]);
  const globalBackSwipeResponder = useMemo(
    () =>
      createGlobalBackSwipeResponder({
        canStart: () => routeBackOneLevel(route, project) !== route,
        onCancel: cancelBackSwipe,
        onCommit: commitBackSwipe,
        onGrant: beginBackSwipe,
        onMove: moveBackSwipe
      }),
    [beginBackSwipe, cancelBackSwipe, commitBackSwipe, moveBackSwipe, project, route]
  );
  const backSwipeUnderlayOpacity = backSwipeX.interpolate({
    extrapolate: "clamp",
    inputRange: [0, Math.max(1, windowWidth * 0.65)],
    outputRange: [0.55, 1]
  });
  const backSwipeUnderlayScale = backSwipeX.interpolate({
    extrapolate: "clamp",
    inputRange: [0, Math.max(1, windowWidth)],
    outputRange: [0.985, 1]
  });
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

  function renderRoute(routeName: RouteName, options?: { isPreview?: boolean }) {
    if (routeName === "projects" || routeName === "workspace") {
      return (
        <ProjectsScreen
          api={store.api}
          initialProjects={cachedProjects}
          isConnected={store.bootstrap?.host?.status === "online"}
          onProjectsLoaded={setCachedProjects}
          onProject={(nextProject) => {
            setProject(nextProject);
            navigateToRoute("project");
          }}
          onSettings={() => navigateToRoute("settings")}
          refreshEnabled={!options?.isPreview}
        />
      );
    }

    if (routeName === "project" && project) {
      return (
        <ProjectDetailScreen
          api={store.api}
          initialConversations={cachedConversationsByProject[project.id] ?? []}
          onBack={goBackOneLevel}
          onConversation={(nextConversation) => {
            setConversation(nextConversation);
            navigateToRoute("conversation");
          }}
          onConversationsLoaded={updateCachedConversations}
          project={project}
          refreshEnabled={!options?.isPreview}
        />
      );
    }

    if (routeName === "conversation" && conversation) {
      return (
        <ConversationScreen
          api={store.api}
          conversation={conversation}
          messageCacheScope={store.messageCacheScope}
          modelSettings={store.modelSettings}
          onBack={goBackOneLevel}
          onModelSettingsChange={store.saveModelSettings}
          refreshEnabled={!options?.isPreview}
        />
      );
    }

    if (routeName === "settings") {
      return (
        <SettingsScreen
          onBack={goBackOneLevel}
          onSignOut={() => {
            void store.signOut();
            setRoute("projects");
          }}
        />
      );
    }

    return null;
  }

  return (
    <View style={styles.navigationShell} {...globalBackSwipeResponder.panHandlers}>
      {swipeBackPreviewRoute ? (
        <Animated.View
          key={swipeBackPreviewRoute.layerKey}
          pointerEvents="none"
          style={[
            styles.routeLayer,
            styles.routeUnderlay,
            {
              opacity: backSwipeUnderlayOpacity,
              transform: [{ scale: backSwipeUnderlayScale }]
            }
          ]}
        >
          {renderRoute(swipeBackPreviewRoute.routeName, { isPreview: true })}
        </Animated.View>
      ) : null}
      <Animated.View
        key={activeRouteLayerKey}
        style={[
          styles.routeLayer,
          styles.routeTopLayer,
          swipeBackPreviewRoute ? { transform: [{ translateX: backSwipeX }] } : null
        ]}
      >
        {renderRoute(route)}
      </Animated.View>
      {forwardRoute ? (
        <Animated.View
          key={forwardRoute.layerKey}
          style={[
            styles.routeLayer,
            styles.routeTopLayer,
            styles.routeForwardLayer,
            { transform: [{ translateX: forwardSlideX }] }
          ]}
        >
          {renderRoute(forwardRoute.routeName, { isPreview: true })}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  navigationShell: {
    backgroundColor: colors.canvas,
    flex: 1,
    overflow: "hidden"
  },
  routeLayer: {
    ...StyleSheet.absoluteFillObject
  },
  routeTopLayer: {
    backgroundColor: colors.canvas,
    shadowColor: "#000000",
    shadowOffset: { height: 0, width: -8 },
    shadowOpacity: 0.24,
    shadowRadius: 18
  },
  routeForwardLayer: {
    shadowOffset: { height: 0, width: -10 },
    shadowOpacity: 0.32,
    shadowRadius: 22
  },
  routeUnderlay: {
    backgroundColor: colors.canvas
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

function routeBackOneLevel(route: RouteName, project: ProjectSummary | null): RouteName {
  if (route === "conversation") {
    return project ? "project" : "projects";
  }

  if (route === "project" || route === "settings" || route === "workspace") {
    return "projects";
  }

  return route;
}

function createGlobalBackSwipeResponder(input: {
  canStart(): boolean;
  onCancel(): void;
  onCommit(): void;
  onGrant(): void;
  onMove(distance: number): void;
}) {
  return PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      input.canStart() && shouldStartGlobalBackSwipe(gesture),
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      input.canStart() && shouldStartGlobalBackSwipe(gesture),
    onPanResponderGrant: input.onGrant,
    onPanResponderMove: (_event, gesture) => {
      input.onMove(gesture.dx);
    },
    onPanResponderRelease: (_event, gesture) => {
      if (
        gesture.dx >= GLOBAL_BACK_SWIPE_DISTANCE &&
        Math.abs(gesture.dy) <= GLOBAL_BACK_SWIPE_VERTICAL_TOLERANCE
      ) {
        input.onCommit();
      } else {
        input.onCancel();
      }
    },
    onPanResponderTerminate: input.onCancel
  });
}

function shouldStartGlobalBackSwipe(gesture: { dx: number; dy: number }) {
  return gesture.dx > 18 && Math.abs(gesture.dy) < 36;
}

function clampSwipeDistance(distance: number, windowWidth: number) {
  return Math.max(0, Math.min(distance, windowWidth + GLOBAL_BACK_SWIPE_OVERSHOOT));
}
