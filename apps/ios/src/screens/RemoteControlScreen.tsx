import { useEffect, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { lockAsync, OrientationLock } from "expo-screen-orientation";
import {
  Image,
  Modal,
  type NativeSyntheticEvent,
  type NativeTouchEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";

import type { ApiClient } from "../api/client";
import { Button, Header, StatusPill } from "../components/Controls";
import { Screen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type { RemoteControlCursorPosition, RemoteControlSession } from "../types";

const REMOTE_FRAME_REFRESH_INTERVAL_MS = 300;
const CURSOR_SYNC_TOLERANCE = 0.012;
const CURRENT_CURSOR_CLICK_ORIGIN = { x: 0, y: 0 };
const VISUAL_CURSOR_SIZE = 30;

type VisualCursorSyncState = "pending" | "synced";

interface RemoteControlScreenProps {
  api: ApiClient;
  autoStartKey: number;
  hostMachineId: string;
  onBack(): void;
}

export function RemoteControlScreen({
  api,
  autoStartKey,
  hostMachineId,
  onBack
}: RemoteControlScreenProps) {
  const [session, setSession] = useState<RemoteControlSession | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [frameAspectRatio, setFrameAspectRatio] = useState(16 / 10);
  const [keyboardText, setKeyboardText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [visualCursorPosition, setVisualCursorPositionState] =
    useState<RemoteControlCursorPosition | null>(null);
  const [visualCursorSyncState, setVisualCursorSyncStateState] =
    useState<VisualCursorSyncState>("synced");
  const [fullScreenSurfaceSize, setFullScreenSurfaceSize] = useState({ height: 1, width: 1 });
  const windowDimensions = useWindowDimensions();
  const lastFrameSequenceRef = useRef(-1);
  const startedAutoStartKeyRef = useRef(0);
  const visualCursorPositionRef = useRef<RemoteControlCursorPosition | null>(null);
  const visualCursorSyncStateRef = useRef<VisualCursorSyncState>("synced");
  const fullScreenFrameStyle = remoteFrameLayout({
    aspectRatio: frameAspectRatio,
    height: windowDimensions.height,
    width: windowDimensions.width
  });

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
      setVisualCursorPosition(null, "synced");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to end remote control");
    }
  }

  function openFullScreen() {
    setIsFullScreen(true);
  }

  function closeFullScreen() {
    setIsFullScreen(false);
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

  function positionFromSurfaceEvent(event: NativeSyntheticEvent<NativeTouchEvent>) {
    return clampCursorPosition({
      x: event.nativeEvent.locationX / fullScreenSurfaceSize.width,
      y: event.nativeEvent.locationY / fullScreenSurfaceSize.height
    });
  }

  function handleRemoteSurfacePress(event: NativeSyntheticEvent<NativeTouchEvent>) {
    void sendRemoteCursorMove(positionFromSurfaceEvent(event));
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send click");
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to show all desktops");
    }
  }

  async function sendText() {
    if (!session || keyboardText.trim().length === 0) {
      return;
    }

    try {
      setSession(
        await api.sendRemoteInput(session.id, {
          type: "text",
          value: keyboardText
        })
      );
      setKeyboardText("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send text");
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
          <Pressable
            onLayout={(event) =>
              setFullScreenSurfaceSize({
                height: Math.max(1, event.nativeEvent.layout.height),
                width: Math.max(1, event.nativeEvent.layout.width)
              })
            }
            onPressIn={handleRemoteSurfacePress}
            style={[styles.fullScreenSurface, fullScreenFrameStyle]}
          >
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
          </Pressable>
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
          <View pointerEvents="box-none" style={styles.remoteClickRail}>
            <Pressable
              accessibilityLabel="Left click"
              accessibilityRole="button"
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
          </View>
        </View>
      </Modal>

      <View style={sharedStyles.card}>
        <TextInput
          keyboardAppearance="dark"
          onChangeText={setKeyboardText}
          placeholder="Type to Mac"
          placeholderTextColor={colors.muted}
          style={sharedStyles.input}
          value={keyboardText}
        />
        <View style={{ marginTop: 10 }}>
          <Button disabled={!session || session.status === "ended"} onPress={sendText}>
            Send Text
          </Button>
        </View>
      </View>

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
  return Math.max(0, Math.min(1, value));
}

function remoteFrameLayout(input: { aspectRatio: number; height: number; width: number }) {
  const aspectRatio =
    Number.isFinite(input.aspectRatio) && input.aspectRatio > 0 ? input.aspectRatio : 16 / 10;
  const availableWidth = Math.max(1, input.width);
  const availableHeight = Math.max(1, input.height);
  const availableAspectRatio = availableWidth / availableHeight;

  if (availableAspectRatio > aspectRatio) {
    return {
      height: availableHeight,
      width: availableHeight * aspectRatio
    };
  }

  return {
    height: availableWidth / aspectRatio,
    width: availableWidth
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
  fullScreenSurface: {
    alignItems: "center",
    backgroundColor: "#05070b",
    justifyContent: "center",
    overflow: "hidden"
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
    gap: 10,
    left: 14,
    position: "absolute",
    top: "50%",
    transform: [{ translateY: -106 }]
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
