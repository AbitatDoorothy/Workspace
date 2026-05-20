import { useEffect, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { lockAsync, OrientationLock } from "expo-screen-orientation";
import {
  type GestureResponderEvent,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  type NativeTouchEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ApiClient } from "../api/client";
import { Button, Header, StatusPill } from "../components/Controls";
import { Screen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type {
  RemoteControlCursorPosition,
  RemoteControlSession,
  RemoteControlTextTarget
} from "../types";

const REMOTE_FRAME_REFRESH_INTERVAL_MS = 120;
const CURSOR_SYNC_TOLERANCE = 0.012;
const CURRENT_CURSOR_CLICK_ORIGIN = { x: 0, y: 0 };
const DEFAULT_REMOTE_VIEWPORT: RemoteViewportState = { offsetX: 0, offsetY: 0, scale: 1 };
const MAX_REMOTE_VIEWPORT_SCALE = 4;
const MIN_REMOTE_VIEWPORT_SCALE = 1;
const REMOTE_TAP_MOVEMENT_TOLERANCE = 8;
const VISUAL_CURSOR_SIZE = 30;
const FULL_SCREEN_CONTROL_RAIL_MIN_LEFT = 72;
const FULL_SCREEN_CONTROL_RAIL_SAFE_AREA_GAP = 18;
const FULL_SCREEN_CONTROL_RAIL_WIDTH = 84;
const FULL_SCREEN_CONTROL_RAIL_TO_COMPOSER_GAP = 16;
const FULL_SCREEN_CONTROL_RAIL_TO_SURFACE_GAP = 18;
const FULL_SCREEN_SURFACE_EDGE_GAP = 10;

type VisualCursorSyncState = "pending" | "synced";

interface RemoteViewportState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface RemoteSurfaceSize {
  height: number;
  width: number;
}

interface SurfacePoint {
  x: number;
  y: number;
}

interface PinchGestureState {
  anchor: SurfacePoint;
  initialDistance: number;
}

interface RemoteControlScreenProps {
  api: ApiClient;
  autoStartKey: number;
  hostMachineId: string;
  onBack(): void;
  onFullScreenChange?(isFullScreen: boolean): void;
}

export function RemoteControlScreen({
  api,
  autoStartKey,
  hostMachineId,
  onBack,
  onFullScreenChange
}: RemoteControlScreenProps) {
  const [session, setSession] = useState<RemoteControlSession | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [frameAspectRatio, setFrameAspectRatio] = useState(16 / 10);
  const [keyboardDraft, setKeyboardDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isKeyboardComposerOpen, setIsKeyboardComposerOpen] = useState(false);
  const [isTextTargetLoading, setIsTextTargetLoading] = useState(false);
  const [isMissionControlMode, setIsMissionControlMode] = useState(false);
  const [focusedTextTarget, setFocusedTextTarget] = useState<RemoteControlTextTarget | null>(null);
  const [visualCursorPosition, setVisualCursorPositionState] =
    useState<RemoteControlCursorPosition | null>(null);
  const [visualCursorSyncState, setVisualCursorSyncStateState] =
    useState<VisualCursorSyncState>("synced");
  const [fullScreenSurfaceSize, setFullScreenSurfaceSize] = useState({ height: 1, width: 1 });
  const [remoteViewport, setRemoteViewportState] =
    useState<RemoteViewportState>(DEFAULT_REMOTE_VIEWPORT);
  const safeAreaInsets = useSafeAreaInsets();
  const windowDimensions = useWindowDimensions();
  const lastFrameSequenceRef = useRef(-1);
  const didPinchDuringGestureRef = useRef(false);
  const pinchGestureRef = useRef<PinchGestureState | null>(null);
  const remoteViewportRef = useRef<RemoteViewportState>(DEFAULT_REMOTE_VIEWPORT);
  const startedAutoStartKeyRef = useRef(0);
  const touchStartRef = useRef<SurfacePoint | null>(null);
  const visualCursorPositionRef = useRef<RemoteControlCursorPosition | null>(null);
  const visualCursorSyncStateRef = useRef<VisualCursorSyncState>("synced");
  const fullScreenControlRailLeft = Math.max(
    FULL_SCREEN_CONTROL_RAIL_MIN_LEFT,
    safeAreaInsets.left + FULL_SCREEN_CONTROL_RAIL_SAFE_AREA_GAP
  );
  const fullScreenControlLaneWidth =
    fullScreenControlRailLeft +
    FULL_SCREEN_CONTROL_RAIL_WIDTH +
    FULL_SCREEN_CONTROL_RAIL_TO_SURFACE_GAP;
  const fullScreenSurfaceRightInset = Math.max(
    FULL_SCREEN_SURFACE_EDGE_GAP,
    safeAreaInsets.right + FULL_SCREEN_SURFACE_EDGE_GAP
  );
  const fullScreenFrameStyle = remoteFrameLayout({
    aspectRatio: frameAspectRatio,
    height: windowDimensions.height,
    leftInset: fullScreenControlLaneWidth,
    rightInset: fullScreenSurfaceRightInset,
    width: windowDimensions.width
  });
  const fullScreenContentStyle = remoteViewportContentStyle({
    height: fullScreenFrameStyle.height,
    viewport: remoteViewport,
    width: fullScreenFrameStyle.width
  });
  const keyboardComposerLayerStyle = {
    paddingLeft:
      fullScreenControlRailLeft +
      FULL_SCREEN_CONTROL_RAIL_WIDTH +
      FULL_SCREEN_CONTROL_RAIL_TO_COMPOSER_GAP
  };
  const fullScreenControlRailVerticalStyle = {
    bottom: Math.max(12, safeAreaInsets.bottom + 12),
    top: Math.max(12, safeAreaInsets.top + 12)
  };

  useEffect(() => {
    void lockAsync(isFullScreen ? OrientationLock.LANDSCAPE : OrientationLock.PORTRAIT_UP).catch(
      (caught) => {
        setError(caught instanceof Error ? caught.message : "Unable to rotate remote control");
      }
    );

    return () => {
      if (isFullScreen) {
        void lockAsync(OrientationLock.PORTRAIT_UP).catch(() => undefined);
      }
    };
  }, [isFullScreen]);

  useEffect(() => {
    return () => {
      onFullScreenChange?.(false);
    };
  }, [onFullScreenChange]);

  useEffect(() => {
    if (!hostMachineId || autoStartKey <= 0 || startedAutoStartKeyRef.current === autoStartKey) {
      return;
    }

    startedAutoStartKeyRef.current = autoStartKey;
    void startSessionFromDashboard();
  }, [autoStartKey, hostMachineId]);

  useEffect(() => {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;
    const sessionId = session.id;
    async function refreshFrame() {
      if (refreshInFlight) {
        return;
      }

      refreshInFlight = true;
      try {
        const result = await api.getRemoteFrame(sessionId, lastFrameSequenceRef.current);
        if (cancelled) {
          return;
        }

        setSession(result.session);
        syncVisualCursorFromHost(result.session.cursorPosition ?? null);
        if (result.frame) {
          lastFrameSequenceRef.current = result.frame.sequence;
          setFrameAspectRatio(result.frame.width / result.frame.height);
          setFrameUri(`data:image/jpeg;base64,${result.frame.dataBase64}`);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to refresh Mac screen");
        }
      } finally {
        refreshInFlight = false;
      }
    }

    void refreshFrame();
    const timer = setInterval(() => {
      void refreshFrame();
    }, REMOTE_FRAME_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, session?.id, session?.status]);

  async function startSessionFromDashboard() {
    setError(null);
    lastFrameSequenceRef.current = -1;
    setFrameUri(null);
    setFrameAspectRatio(16 / 10);
    setIsMissionControlMode(false);
    setRemoteViewport(DEFAULT_REMOTE_VIEWPORT);
    setVisualCursorPosition(null, "synced");

    try {
      const nextSession = await api.createRemoteSession(hostMachineId);
      setSession(nextSession);
      syncVisualCursorFromHost(nextSession.cursorPosition ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start remote control");
    }
  }

  async function end() {
    if (!session) {
      return;
    }

    try {
      setSession(await api.endRemoteSession(session.id));
      setIsMissionControlMode(false);
      closeKeyboardComposer();
      setRemoteViewport(DEFAULT_REMOTE_VIEWPORT);
      setVisualCursorPosition(null, "synced");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to end remote control");
    }
  }

  function openFullScreen() {
    onFullScreenChange?.(true);
    setIsFullScreen(true);
  }

  function closeFullScreen() {
    onFullScreenChange?.(false);
    closeKeyboardComposer();
    setIsFullScreen(false);
    setIsMissionControlMode(false);
    setRemoteViewport(DEFAULT_REMOTE_VIEWPORT);
  }

  function closeKeyboardComposer() {
    Keyboard.dismiss();
    setIsKeyboardComposerOpen(false);
    setKeyboardDraft("");
    setFocusedTextTarget(null);
    setIsTextTargetLoading(false);
  }

  function setRemoteViewport(nextViewport: RemoteViewportState) {
    remoteViewportRef.current = nextViewport;
    setRemoteViewportState(nextViewport);
  }

  function setVisualCursorPosition(
    nextPosition: RemoteControlCursorPosition | null,
    nextSyncState: VisualCursorSyncState
  ) {
    visualCursorPositionRef.current = nextPosition;
    visualCursorSyncStateRef.current = nextSyncState;
    setVisualCursorPositionState(nextPosition);
    setVisualCursorSyncStateState(nextSyncState);
  }

  function syncVisualCursorFromHost(nextPosition: RemoteControlCursorPosition | null) {
    if (!nextPosition) {
      return;
    }

    const currentVisualPosition = visualCursorPositionRef.current;
    if (
      !currentVisualPosition ||
      visualCursorSyncStateRef.current === "synced" ||
      cursorPositionsMatch(currentVisualPosition, nextPosition)
    ) {
      setVisualCursorPosition(nextPosition, "synced");
    }
  }

  function positionFromSurfacePoint(point: SurfacePoint) {
    return cursorPositionFromSurfacePoint(point, remoteViewportRef.current, fullScreenSurfaceSize);
  }

  function remoteSurfaceShouldSetResponder() {
    return true;
  }

  function remoteSurfaceShouldSetResponderCapture(event: GestureResponderEvent) {
    if (event.nativeEvent.touches.length >= 2) {
      claimRemoteViewportPinch(event.nativeEvent.touches);
      return true;
    }

    return false;
  }

  function handleRemoteSurfaceResponderGrant(event: GestureResponderEvent) {
    const touches = event.nativeEvent.touches;
    if (touches.length >= 2) {
      claimRemoteViewportPinch(touches);
      return;
    }

    if (didPinchDuringGestureRef.current) {
      touchStartRef.current = null;
      return;
    }

    didPinchDuringGestureRef.current = false;
    pinchGestureRef.current = null;
    touchStartRef.current = surfacePointFromTouchEvent(event);
  }

  function handleRemoteSurfaceResponderMove(event: GestureResponderEvent) {
    const touches = event.nativeEvent.touches;
    if (touches.length < 2) {
      return;
    }

    claimRemoteViewportPinch(touches);
  }

  function handleRemoteSurfaceResponderRelease(event: GestureResponderEvent) {
    if (pinchGestureRef.current || didPinchDuringGestureRef.current) {
      pinchGestureRef.current = null;
      touchStartRef.current = null;
      if (event.nativeEvent.touches.length === 0) {
        didPinchDuringGestureRef.current = false;
      }
      return;
    }

    const releasePoint = surfacePointFromTouchEvent(event);
    const startPoint = touchStartRef.current;
    touchStartRef.current = null;
    if (!startPoint || distanceBetweenPoints(startPoint, releasePoint) > REMOTE_TAP_MOVEMENT_TOLERANCE) {
      return;
    }

    void sendRemoteCursorMove(positionFromSurfacePoint(releasePoint));
  }

  function handleRemoteSurfaceResponderTerminate() {
    pinchGestureRef.current = null;
    touchStartRef.current = null;
    didPinchDuringGestureRef.current = false;
  }

  function claimRemoteViewportPinch(touches: readonly NativeTouchEvent[]) {
    didPinchDuringGestureRef.current = true;
    touchStartRef.current = null;
    if (pinchGestureRef.current) {
      updateRemoteViewportPinch(touches);
      return;
    }

    startRemoteViewportPinch(touches);
  }

  function startRemoteViewportPinch(touches: readonly NativeTouchEvent[]) {
    const metrics = pinchMetricsFromTouches(touches);
    if (!metrics) {
      return;
    }

    const viewport = remoteViewportRef.current;
    pinchGestureRef.current = {
      anchor: {
        x: (metrics.center.x - viewport.offsetX) / viewport.scale,
        y: (metrics.center.y - viewport.offsetY) / viewport.scale
      },
      initialDistance: metrics.distance
    };
  }

  function updateRemoteViewportPinch(touches: readonly NativeTouchEvent[]) {
    const gesture = pinchGestureRef.current;
    const metrics = pinchMetricsFromTouches(touches);
    if (!gesture || !metrics) {
      return;
    }

    const nextScale = clamp(
      remoteViewportRef.current.scale * (metrics.distance / Math.max(1, gesture.initialDistance)),
      MIN_REMOTE_VIEWPORT_SCALE,
      MAX_REMOTE_VIEWPORT_SCALE
    );
    const nextViewport = clampRemoteViewport(
      {
        offsetX: metrics.center.x - gesture.anchor.x * nextScale,
        offsetY: metrics.center.y - gesture.anchor.y * nextScale,
        scale: nextScale
      },
      fullScreenSurfaceSize
    );
    setRemoteViewport(nextViewport);
    pinchGestureRef.current = {
      anchor: {
        x: (metrics.center.x - nextViewport.offsetX) / nextViewport.scale,
        y: (metrics.center.y - nextViewport.offsetY) / nextViewport.scale
      },
      initialDistance: metrics.distance
    };
  }

  async function sendRemoteCursorMove(position: RemoteControlCursorPosition) {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    try {
      setVisualCursorPosition(position, "pending");
      const nextSession = await api.sendRemoteInput(session.id, {
        phase: "move",
        type: "pointer",
        x: position.x,
        y: position.y
      });
      setSession(nextSession);
      syncVisualCursorFromHost(nextSession.cursorPosition ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to move cursor");
    }
  }

  async function sendRemoteClick(buttons: 1 | 2) {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    try {
      setVisualCursorPosition(visualCursorPositionRef.current, "pending");
      const nextSession = await api.sendRemoteInput(session.id, {
        buttons,
        dx: 0,
        dy: 0,
        phase: "up",
        type: "pointer",
        x: CURRENT_CURSOR_CLICK_ORIGIN.x,
        y: CURRENT_CURSOR_CLICK_ORIGIN.y
      });
      setSession(nextSession);
      syncVisualCursorFromHost(nextSession.cursorPosition ?? null);
      if (buttons === 1 && isMissionControlMode) {
        setIsMissionControlMode(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send click");
    }
  }

  async function sendRemoteDoubleClick() {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    try {
      setVisualCursorPosition(visualCursorPositionRef.current, "pending");
      const nextSession = await api.sendRemoteInput(session.id, {
        buttons: 1,
        clickCount: 2,
        dx: 0,
        dy: 0,
        phase: "up",
        type: "pointer",
        x: CURRENT_CURSOR_CLICK_ORIGIN.x,
        y: CURRENT_CURSOR_CLICK_ORIGIN.y
      });
      setSession(nextSession);
      syncVisualCursorFromHost(nextSession.cursorPosition ?? null);
      if (isMissionControlMode) {
        setIsMissionControlMode(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send double click");
    }
  }

  async function showMissionControl() {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    try {
      setSession(
        await api.sendRemoteInput(session.id, {
          key: "mission-control",
          modifiers: [],
          type: "key"
        })
      );
      setIsMissionControlMode(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to show all desktops");
    }
  }

  async function showDock() {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    try {
      setSession(
        await api.sendRemoteInput(session.id, {
          key: "dock",
          modifiers: [],
          type: "key"
        })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to show Dock");
    }
  }

  async function sendRemoteEnter() {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    try {
      setSession(
        await api.sendRemoteInput(session.id, {
          key: "enter",
          modifiers: [],
          type: "key"
        })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send Enter");
    }
  }

  async function openKeyboardComposer() {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    setError(null);
    setKeyboardDraft("");
    setFocusedTextTarget(null);
    setIsTextTargetLoading(true);
    setIsKeyboardComposerOpen(true);

    try {
      setFocusedTextTarget(await api.getRemoteTextTarget(session.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to inspect Mac text input");
    } finally {
      setIsTextTargetLoading(false);
    }
  }

  async function finishKeyboardTyping() {
    const value = keyboardDraft;
    closeKeyboardComposer();
    if (value.length === 0) {
      return;
    }

    await sendTextDraft(value);
  }

  async function sendTextDraft(value: string) {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    try {
      setSession(
        await api.sendRemoteInput(session.id, {
          type: "text",
          value
        })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send text");
    }
  }

  async function moveMissionControlDesktop(direction: "left" | "right") {
    if (!session || session.status === "ended" || session.status === "failed") {
      return;
    }

    try {
      setSession(
        await api.sendRemoteInput(session.id, {
          key: `mission-control-${direction}`,
          modifiers: [],
          type: "key"
        })
      );
      setIsMissionControlMode(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to move between desktops");
    }
  }

  return (
    <Screen>
      <Header
        eyebrow="Remote Control"
        title="Mac Screen"
        subtitle="Whole Mac screen from this paired host."
      />

      <View style={sharedStyles.card}>
        <View style={[sharedStyles.row, { justifyContent: "space-between" }]}>
          <Text style={sharedStyles.value}>{session ? session.status : "Not connected"}</Text>
          <StatusPill status={session?.status ?? "pending"} />
        </View>
        {permissionMessage(session) ? (
          <Text style={[sharedStyles.subtitle, { color: colors.warning }]}>
            {permissionMessage(session)}
          </Text>
        ) : null}
        {error ? (
          <Text style={[sharedStyles.subtitle, { color: colors.danger }]}>{error}</Text>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel="Open full screen remote control"
        accessibilityRole="button"
        onPress={openFullScreen}
        style={[styles.remoteSurface, { aspectRatio: frameAspectRatio }]}
      >
        {frameUri ? (
          <Image resizeMode="contain" source={{ uri: frameUri }} style={styles.remoteFrame} />
        ) : (
          <Text style={styles.remotePlaceholder}>Waiting for Mac screen</Text>
        )}
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={closeFullScreen}
        presentationStyle="fullScreen"
        statusBarTranslucent
        supportedOrientations={["landscape", "landscape-left", "landscape-right"]}
        visible={isFullScreen}
      >
        <View style={styles.fullScreenBackdrop}>
          <View
            onLayout={(event) => {
              const nextSize = {
                height: Math.max(1, event.nativeEvent.layout.height),
                width: Math.max(1, event.nativeEvent.layout.width)
              };
              setFullScreenSurfaceSize(nextSize);
              setRemoteViewport(clampRemoteViewport(remoteViewportRef.current, nextSize));
            }}
            onMoveShouldSetResponderCapture={remoteSurfaceShouldSetResponderCapture}
            onMoveShouldSetResponder={remoteSurfaceShouldSetResponder}
            onResponderGrant={handleRemoteSurfaceResponderGrant}
            onResponderMove={handleRemoteSurfaceResponderMove}
            onResponderRelease={handleRemoteSurfaceResponderRelease}
            onResponderTerminate={handleRemoteSurfaceResponderTerminate}
            onStartShouldSetResponderCapture={remoteSurfaceShouldSetResponderCapture}
            onStartShouldSetResponder={remoteSurfaceShouldSetResponder}
            style={[styles.fullScreenSurface, fullScreenFrameStyle]}
          >
            <View pointerEvents="none" style={[styles.fullScreenContent, fullScreenContentStyle]}>
              {frameUri ? (
                <Image resizeMode="contain" source={{ uri: frameUri }} style={styles.remoteFrame} />
              ) : (
                <Text style={styles.remotePlaceholder}>Waiting for Mac screen</Text>
              )}
              {visualCursorPosition ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.visualCursor,
                    {
                      left: `${visualCursorPosition.x * 100}%`,
                      top: `${visualCursorPosition.y * 100}%`
                    },
                    visualCursorSyncState === "synced"
                      ? styles.visualCursorSynced
                      : styles.visualCursorPending
                  ]}
                >
                  <Feather
                    color={visualCursorSyncState === "synced" ? "#22c55e" : "#f8fafc"}
                    name="mouse-pointer"
                    size={VISUAL_CURSOR_SIZE}
                  />
                </View>
              ) : null}
            </View>
          </View>
          <Pressable
            accessibilityLabel="Exit full screen remote control"
            accessibilityRole="button"
            onPress={closeFullScreen}
            style={({ pressed }) => [
              styles.fullScreenCloseButton,
              pressed ? styles.fullScreenCloseButtonPressed : null
            ]}
          >
            <Feather color="#f3f3f3" name="x" size={22} />
          </Pressable>
          <ScrollView
            contentContainerStyle={styles.remoteClickRailContent}
            style={[
              styles.remoteClickRail,
              { left: fullScreenControlRailLeft },
              fullScreenControlRailVerticalStyle,
              isMissionControlMode ? styles.remoteClickRailThree : styles.remoteClickRailSix
            ]}
            showsVerticalScrollIndicator={false}
          >
            {isMissionControlMode ? (
              <>
                <Pressable
                  accessibilityLabel="Move to left desktop"
                  accessibilityRole="button"
                  onPress={() => void moveMissionControlDesktop("left")}
                  style={({ pressed }) => [
                    styles.remoteClickButton,
                    pressed ? styles.remoteClickButtonPressed : null
                  ]}
                >
                  <Feather color="#f8fafc" name="arrow-left" size={18} />
                  <Text style={styles.remoteClickLabel}>Left</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Move to right desktop"
                  accessibilityRole="button"
                  onPress={() => void moveMissionControlDesktop("right")}
                  style={({ pressed }) => [
                    styles.remoteClickButton,
                    pressed ? styles.remoteClickButtonPressed : null
                  ]}
                >
                  <Feather color="#f8fafc" name="arrow-right" size={18} />
                  <Text style={styles.remoteClickLabel}>Right</Text>
                </Pressable>
                <Pressable
                  accessibilityHint="Long press for double click"
                  accessibilityLabel="Left click"
                  accessibilityRole="button"
                  onLongPress={() => void sendRemoteDoubleClick()}
                  onPress={() => void sendRemoteClick(1)}
                  style={({ pressed }) => [
                    styles.remoteClickButton,
                    pressed ? styles.remoteClickButtonPressed : null
                  ]}
                >
                  <Feather color="#f8fafc" name="mouse-pointer" size={18} />
                  <Text style={styles.remoteClickLabel}>Left click</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  accessibilityHint="Long press for double click"
                  accessibilityLabel="Left click"
                  accessibilityRole="button"
                  onLongPress={() => void sendRemoteDoubleClick()}
                  onPress={() => void sendRemoteClick(1)}
                  style={({ pressed }) => [
                    styles.remoteClickButton,
                    pressed ? styles.remoteClickButtonPressed : null
                  ]}
                >
                  <Feather color="#f8fafc" name="mouse-pointer" size={18} />
                  <Text style={styles.remoteClickLabel}>Left click</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Right click"
                  accessibilityRole="button"
                  onPress={() => void sendRemoteClick(2)}
                  style={({ pressed }) => [
                    styles.remoteClickButton,
                    pressed ? styles.remoteClickButtonPressed : null
                  ]}
                >
                  <Feather color="#f8fafc" name="corner-down-left" size={18} />
                  <Text style={styles.remoteClickLabel}>Right click</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Open remote keyboard"
                  accessibilityRole="button"
                  onPress={() => void openKeyboardComposer()}
                  style={({ pressed }) => [
                    styles.remoteClickButton,
                    pressed ? styles.remoteClickButtonPressed : null
                  ]}
                >
                  <Feather color="#f8fafc" name="type" size={18} />
                  <Text style={styles.remoteClickLabel}>Keyboard</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Enter"
                  accessibilityRole="button"
                  onPress={() => void sendRemoteEnter()}
                  style={({ pressed }) => [
                    styles.remoteClickButton,
                    pressed ? styles.remoteClickButtonPressed : null
                  ]}
                >
                  <Feather color="#f8fafc" name="corner-down-left" size={18} />
                  <Text style={styles.remoteClickLabel}>Enter</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Show Dock"
                  accessibilityRole="button"
                  onPress={() => void showDock()}
                  style={({ pressed }) => [
                    styles.remoteClickButton,
                    pressed ? styles.remoteClickButtonPressed : null
                  ]}
                >
                  <Feather color="#f8fafc" name="monitor" size={18} />
                  <Text style={styles.remoteClickLabel}>Dock</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Show all desktops"
                  accessibilityRole="button"
                  onPress={() => void showMissionControl()}
                  style={({ pressed }) => [
                    styles.remoteClickButton,
                    pressed ? styles.remoteClickButtonPressed : null
                  ]}
                >
                  <Feather color="#f8fafc" name="grid" size={18} />
                  <Text style={styles.remoteClickLabel}>Desktops</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
          {isKeyboardComposerOpen ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              pointerEvents="box-none"
              style={[styles.keyboardComposerLayer, keyboardComposerLayerStyle]}
            >
              <View style={styles.keyboardComposer}>
                <Text style={styles.keyboardComposerTarget}>
                  {keyboardTargetMessage(isTextTargetLoading, focusedTextTarget)}
                </Text>
                <TextInput
                  autoFocus
                  keyboardAppearance="dark"
                  multiline
                  onChangeText={setKeyboardDraft}
                  placeholder="Type on iPhone"
                  placeholderTextColor="rgba(248,250,252,0.46)"
                  style={styles.keyboardComposerInput}
                  value={keyboardDraft}
                />
                <View style={styles.keyboardComposerActions}>
                  <Pressable
                    accessibilityLabel="Cancel remote keyboard"
                    accessibilityRole="button"
                    onPress={closeKeyboardComposer}
                    style={({ pressed }) => [
                      styles.keyboardComposerButton,
                      pressed ? styles.remoteClickButtonPressed : null
                    ]}
                  >
                    <Text style={styles.keyboardComposerButtonLabel}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Finish typing"
                    accessibilityRole="button"
                    onPress={() => void finishKeyboardTyping()}
                    style={({ pressed }) => [
                      styles.keyboardComposerButton,
                      styles.keyboardComposerPrimaryButton,
                      pressed ? styles.remoteClickButtonPressed : null
                    ]}
                  >
                    <Text style={styles.keyboardComposerButtonLabel}>Finish typing</Text>
                  </Pressable>
                </View>
              </View>
            </KeyboardAvoidingView>
          ) : null}
        </View>
      </Modal>

      {session && session.status !== "ended" ? (
        <Button onPress={end} variant="danger">
          End Session
        </Button>
      ) : (
        <Text style={sharedStyles.subtitle}>Start remote control from the dashboard.</Text>
      )}
      <Button onPress={onBack} variant="secondary">
        Back to Dashboard
      </Button>
    </Screen>
  );
}

function permissionMessage(session: RemoteControlSession | null) {
  if (session?.permissionState?.screenRecording === "needed") {
    return "Screen Recording permission is needed on the Mac.";
  }
  if (session?.permissionState?.accessibility === "needed") {
    return "Accessibility permission is needed on the Mac.";
  }
  return null;
}

function keyboardTargetMessage(isLoading: boolean, target: RemoteControlTextTarget | null) {
  if (isLoading) {
    return "Checking Mac focus...";
  }

  if (!target) {
    return "No Mac text field detected. Text will go to the active Mac focus.";
  }

  if (target.isTextInput) {
    return `Typing into ${target.appName}`;
  }

  const focusedRole = target.roleDescription || target.role || "current control";
  return `${target.appName} focus is ${focusedRole}. Text will go to the active Mac focus.`;
}

function cursorPositionsMatch(
  first: RemoteControlCursorPosition,
  second: RemoteControlCursorPosition
) {
  return (
    Math.abs(first.x - second.x) <= CURSOR_SYNC_TOLERANCE &&
    Math.abs(first.y - second.y) <= CURSOR_SYNC_TOLERANCE
  );
}

function clampCursorPosition(position: RemoteControlCursorPosition): RemoteControlCursorPosition {
  return {
    x: clamp01(position.x),
    y: clamp01(position.y)
  };
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function remoteFrameLayout(input: {
  aspectRatio: number;
  height: number;
  leftInset?: number;
  rightInset?: number;
  width: number;
}) {
  const aspectRatio =
    Number.isFinite(input.aspectRatio) && input.aspectRatio > 0 ? input.aspectRatio : 16 / 10;
  const leftInset = Math.max(0, input.leftInset ?? 0);
  const rightInset = Math.max(0, input.rightInset ?? 0);
  const availableWidth = Math.max(1, input.width - leftInset - rightInset);
  const availableHeight = Math.max(1, input.height);
  const availableAspectRatio = availableWidth / availableHeight;
  const frame =
    availableAspectRatio > aspectRatio
      ? {
          height: availableHeight,
          width: availableHeight * aspectRatio
        }
      : {
          height: availableWidth / aspectRatio,
          width: availableWidth
        };

  return {
    height: frame.height,
    left: leftInset + (availableWidth - frame.width) / 2,
    position: "absolute" as const,
    top: (availableHeight - frame.height) / 2,
    width: frame.width
  };
}

function surfacePointFromTouchEvent(event: GestureResponderEvent): SurfacePoint {
  return {
    x: event.nativeEvent.locationX,
    y: event.nativeEvent.locationY
  };
}

function cursorPositionFromSurfacePoint(
  point: SurfacePoint,
  viewport: RemoteViewportState,
  surfaceSize: RemoteSurfaceSize
): RemoteControlCursorPosition {
  const scaledWidth = Math.max(1, surfaceSize.width * viewport.scale);
  const scaledHeight = Math.max(1, surfaceSize.height * viewport.scale);
  return clampCursorPosition({
    x: (point.x - viewport.offsetX) / scaledWidth,
    y: (point.y - viewport.offsetY) / scaledHeight
  });
}

function pinchMetricsFromTouches(touches: readonly NativeTouchEvent[]) {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) {
    return null;
  }

  return {
    center: {
      x: (first.locationX + second.locationX) / 2,
      y: (first.locationY + second.locationY) / 2
    },
    distance: distanceBetweenPoints(
      { x: first.locationX, y: first.locationY },
      { x: second.locationX, y: second.locationY }
    )
  };
}

function distanceBetweenPoints(first: SurfacePoint, second: SurfacePoint) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clampRemoteViewport(
  viewport: RemoteViewportState,
  surfaceSize: RemoteSurfaceSize
): RemoteViewportState {
  const scale = clamp(viewport.scale, MIN_REMOTE_VIEWPORT_SCALE, MAX_REMOTE_VIEWPORT_SCALE);
  if (scale <= MIN_REMOTE_VIEWPORT_SCALE) {
    return DEFAULT_REMOTE_VIEWPORT;
  }

  const scaledWidth = surfaceSize.width * scale;
  const scaledHeight = surfaceSize.height * scale;
  return {
    offsetX: clamp(viewport.offsetX, surfaceSize.width - scaledWidth, 0),
    offsetY: clamp(viewport.offsetY, surfaceSize.height - scaledHeight, 0),
    scale
  };
}

function remoteViewportContentStyle(input: {
  height: number;
  viewport: RemoteViewportState;
  width: number;
}) {
  return {
    height: input.height * input.viewport.scale,
    left: input.viewport.offsetX,
    top: input.viewport.offsetY,
    width: input.width * input.viewport.scale
  };
}

const styles = StyleSheet.create({
  fullScreenBackdrop: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center"
  },
  fullScreenCloseButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.64)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 16,
    top: 18,
    width: 44
  },
  fullScreenCloseButtonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.96 }]
  },
  fullScreenContent: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "absolute"
  },
  fullScreenSurface: {
    alignItems: "center",
    backgroundColor: "#05070b",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative"
  },
  remoteFrame: {
    height: "100%",
    width: "100%"
  },
  remoteClickButton: {
    alignItems: "center",
    backgroundColor: "rgba(15,23,42,0.82)",
    borderColor: "rgba(248,250,252,0.2)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    minHeight: 64,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    width: 84
  },
  remoteClickButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }]
  },
  remoteClickLabel: {
    color: "#f8fafc",
    fontSize: 11,
    textAlign: "center"
  },
  remoteClickRail: {
    position: "absolute",
    width: FULL_SCREEN_CONTROL_RAIL_WIDTH
  },
  remoteClickRailContent: {
    gap: 10,
    paddingVertical: 6
  },
  remoteClickRailFive: {
    flexGrow: 0
  },
  remoteClickRailSix: {
    flexGrow: 0
  },
  remoteClickRailThree: {
    flexGrow: 0
  },
  keyboardComposer: {
    backgroundColor: "rgba(15,23,42,0.94)",
    borderColor: "rgba(248,250,252,0.18)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  keyboardComposerActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end"
  },
  keyboardComposerButton: {
    alignItems: "center",
    backgroundColor: "rgba(30,41,59,0.9)",
    borderColor: "rgba(248,250,252,0.18)",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    minWidth: 92,
    paddingHorizontal: 12
  },
  keyboardComposerButtonLabel: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "700"
  },
  keyboardComposerInput: {
    backgroundColor: "rgba(2,6,23,0.82)",
    borderColor: "rgba(248,250,252,0.14)",
    borderRadius: 8,
    borderWidth: 1,
    color: "#f8fafc",
    fontSize: 15,
    minHeight: 72,
    paddingHorizontal: 10,
    paddingVertical: 9,
    textAlignVertical: "top"
  },
  keyboardComposerLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingBottom: 16,
    paddingRight: 16
  },
  keyboardComposerPrimaryButton: {
    backgroundColor: "#2563eb"
  },
  keyboardComposerTarget: {
    color: "rgba(248,250,252,0.74)",
    fontSize: 12
  },
  remotePlaceholder: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center"
  },
  remoteSurface: {
    alignItems: "center",
    backgroundColor: "#05070b",
    borderColor: "#1f2937",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
    width: "100%"
  },
  visualCursor: {
    height: VISUAL_CURSOR_SIZE,
    marginLeft: -2,
    marginTop: -2,
    position: "absolute",
    width: VISUAL_CURSOR_SIZE
  },
  visualCursorPending: {
    opacity: 0.92
  },
  visualCursorSynced: {
    opacity: 1
  }
});
