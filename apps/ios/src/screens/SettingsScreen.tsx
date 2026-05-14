import { useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ApiClient } from "../api/client";

interface SettingsScreenProps {
  api: ApiClient;
  onBack(): void;
  onSignOut(): void;
}

export function SettingsScreen({ api, onSignOut }: SettingsScreenProps) {
  const [requestLogProgress, setRequestLogProgress] = useState<number | null>(null);
  const [requestLogStatus, setRequestLogStatus] = useState<string | null>(null);
  const isRequestingLog = requestLogProgress !== null;

  async function requestMobileControlLog() {
    if (isRequestingLog) {
      return;
    }

    setRequestLogStatus(null);
    setRequestLogProgress(0.18);
    try {
      const log = await api.requestMobileControlLog();
      setRequestLogProgress(0.72);
      const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
      if (!directory) {
        throw new Error("No writable iPhone directory is available");
      }

      const uri = `${directory}${log.name}`;
      await FileSystem.writeAsStringAsync(uri, log.dataBase64, {
        encoding: FileSystem.EncodingType.Base64
      });
      setRequestLogProgress(1);
      setRequestLogStatus(
        log.truncated
          ? `SAVED LAST ${formatBytes(log.size)}`
          : log.size > 0
            ? `SAVED ${formatBytes(log.size)}`
            : "SAVED EMPTY LOG"
      );

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: "Abitat diagnostics log",
          mimeType: log.mimeType,
          UTI: "public.plain-text"
        });
      }
    } catch (error) {
      setRequestLogStatus(error instanceof Error ? error.message : "Unable to request log");
    } finally {
      setTimeout(() => setRequestLogProgress(null), 700);
    }
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.settingsScreen}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.settingsPanel}>
        <Text accessibilityRole="header" style={styles.brand}>
          ABITAT
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="Request Mac diagnostics log"
            accessibilityRole="button"
            disabled={isRequestingLog}
            onPress={requestMobileControlLog}
            style={({ pressed }) => [
              styles.requestLogButton,
              pressed ? styles.buttonPressed : null,
              isRequestingLog ? styles.buttonDisabled : null
            ]}
          >
            {isRequestingLog ? (
              <ActivityIndicator color="#f3f3f3" size="small" />
            ) : (
              <Text style={styles.requestLogButtonText}>REQUEST LOG</Text>
            )}
          </Pressable>
          {requestLogProgress !== null ? (
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(8, Math.round(requestLogProgress * 100))}%` }
                ]}
              />
            </View>
          ) : null}
          {requestLogStatus ? (
            <Text style={styles.requestLogStatus}>{requestLogStatus}</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Disconnect iPhone from Mac"
          accessibilityRole="button"
          onPress={onSignOut}
          style={({ pressed }) => [styles.disconnectButton, pressed ? styles.buttonPressed : null]}
        >
          <Text style={styles.disconnectButtonText}>DISCONNECT</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: {
    color: "#e6e6e6",
    fontSize: 36,
    fontWeight: "300",
    letterSpacing: 0,
    lineHeight: 44
  },
  disconnectButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: 4,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50,
    minWidth: 272,
    paddingHorizontal: 32
  },
  actions: {
    alignItems: "center",
    gap: 10
  },
  buttonDisabled: {
    opacity: 0.72
  },
  buttonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.99 }]
  },
  disconnectButtonText: {
    color: "#f3f3f3",
    fontSize: 15,
    fontWeight: "400",
    letterSpacing: 7,
    lineHeight: 20
  },
  progressFill: {
    backgroundColor: "#f3f3f3",
    borderRadius: 999,
    height: "100%"
  },
  progressTrack: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    height: 4,
    overflow: "hidden",
    width: 272
  },
  requestLogButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 4,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 272,
    paddingHorizontal: 32
  },
  requestLogButtonText: {
    color: "#f3f3f3",
    fontSize: 12,
    fontWeight: "400",
    letterSpacing: 4,
    lineHeight: 16
  },
  requestLogStatus: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 1.2,
    lineHeight: 14,
    maxWidth: 272,
    textAlign: "center"
  },
  settingsPanel: {
    alignItems: "center",
    gap: 22,
    justifyContent: "center",
    transform: [{ translateY: -18 }]
  },
  settingsScreen: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center"
  }
});

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size}B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)}KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}
