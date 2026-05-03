import { useEffect, useRef, useState } from "react";
import {
  Image,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type NativeTouchEvent
} from "react-native";

import type { ApiClient } from "../api/client";
import { Button, Header, StatusPill } from "../components/Controls";
import { Screen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type { RemoteControlSession } from "../types";

interface RemoteControlScreenProps {
  api: ApiClient;
  hostMachineId: string;
}

type ControlMode = "trackpad" | "direct" | "keyboard";

export function RemoteControlScreen({ api, hostMachineId }: RemoteControlScreenProps) {
  const [session, setSession] = useState<RemoteControlSession | null>(null);
  const [mode, setMode] = useState<ControlMode>("trackpad");
  const [keyboardText, setKeyboardText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [surfaceSize, setSurfaceSize] = useState({ height: 1, width: 1 });
  const seenSignalIds = useRef(new Set<string>());

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;
    const timer = setInterval(() => {
      api
        .listRemoteSignals(session.id)
        .then((signals) => {
          if (cancelled) {
            return;
          }

          for (const signal of signals) {
            if (seenSignalIds.current.has(signal.id)) {
              continue;
            }
            seenSignalIds.current.add(signal.id);

            if (signal.type === "frame" && typeof signal.payload.dataUrl === "string") {
              setFrameDataUrl(signal.payload.dataUrl);
            }
          }
        })
        .catch(() => undefined);
    }, 900);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, session]);

  async function start() {
    setError(null);

    try {
      setSession(await api.createRemoteSession(hostMachineId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start remote control");
    }
  }

  async function end() {
    if (!session) {
      return;
    }

    setSession(await api.endRemoteSession(session.id));
  }

  async function sendPointer(
    phase: "down" | "move" | "up",
    event: NativeSyntheticEvent<NativeTouchEvent>
  ) {
    if (!session) {
      return;
    }

    const touch = event.nativeEvent;
    const x = clamp01(touch.locationX / surfaceSize.width);
    const y = clamp01(touch.locationY / surfaceSize.height);

    await api.sendRemoteSignal(session.id, {
      type: "input",
      payload: {
        event: {
          type: "pointer",
          phase,
          x,
          y
        }
      }
    });
  }

  async function sendText() {
    if (!session || keyboardText.length === 0) {
      return;
    }

    await api.sendRemoteSignal(session.id, {
      type: "input",
      payload: {
        event: {
          type: "text",
          value: keyboardText
        }
      }
    });
    setKeyboardText("");
  }

  return (
    <Screen>
      <Header
        eyebrow="Remote Control"
        title="Mac Screen"
        subtitle="Session signaling works through Abitat; media connects through WebRTC."
      />

      <View style={sharedStyles.card}>
        <View style={[sharedStyles.row, { justifyContent: "space-between" }]}>
          <Text style={sharedStyles.value}>{session ? "Session ready" : "No active session"}</Text>
          <StatusPill status={session?.status ?? "pending"} />
        </View>
        {session?.errorMessage ? (
          <Text style={[sharedStyles.subtitle, { color: colors.danger }]}>
            {session.errorMessage}
          </Text>
        ) : null}
      </View>

      <View
        onLayout={(event) => {
          setSurfaceSize({
            height: Math.max(1, event.nativeEvent.layout.height),
            width: Math.max(1, event.nativeEvent.layout.width)
          });
        }}
        onTouchEnd={(event) => void sendPointer("up", event)}
        onTouchMove={(event) => void sendPointer("move", event)}
        onTouchStart={(event) => void sendPointer("down", event)}
        style={[
          sharedStyles.card,
          {
            alignItems: "center",
            aspectRatio: 9 / 16,
            backgroundColor: "#05070b",
            justifyContent: "center"
          }
        ]}
      >
        {frameDataUrl ? (
          <Image
            resizeMode="contain"
            source={{ uri: frameDataUrl }}
            style={{ height: "100%", width: "100%" }}
          />
        ) : (
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>
            Waiting for Mac frames
          </Text>
        )}
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["trackpad", "direct", "keyboard"] as ControlMode[]).map((item) => (
          <View key={item} style={{ flex: 1 }}>
            <Button onPress={() => setMode(item)} variant={mode === item ? "primary" : "secondary"}>
              {item}
            </Button>
          </View>
        ))}
      </View>

      {mode === "keyboard" ? (
        <View style={sharedStyles.card}>
          <TextInput
            onChangeText={setKeyboardText}
            placeholder="Type to Mac"
            placeholderTextColor={colors.muted}
            style={sharedStyles.input}
            value={keyboardText}
          />
          <View style={{ marginTop: 10 }}>
            <Button onPress={sendText}>Send Text</Button>
          </View>
        </View>
      ) : null}

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      {session && session.status !== "ended" ? (
        <Button onPress={end} variant="danger">
          End Session
        </Button>
      ) : (
        <Button onPress={start}>Start Session</Button>
      )}
    </Screen>
  );
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
