import { useEffect, useState } from "react";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ApiClient } from "../api/client";
import type {
  CodexTokenUsageBucket,
  CodexTokenUsageSummary,
  CodexTokenUsageTimeframe
} from "../types";

interface SettingsScreenProps {
  api: ApiClient;
  onAutomations(): void;
  onBack(): void;
  onStartRemoteControl(): void;
  onSignOut(): void;
}

const TOKEN_USAGE_TIMEFRAMES: Array<{ key: CodexTokenUsageTimeframe; label: string }> = [
  { key: "1d", label: "1D" },
  { key: "7d", label: "7D" },
  { key: "all", label: "ALL" }
];

const TOKEN_USAGE_METRICS: Array<{ field: keyof CodexTokenUsageBucket; label: string }> = [
  { field: "totalTokens", label: "TOTAL" },
  { field: "inputTokens", label: "INPUT" },
  { field: "outputTokens", label: "OUTPUT" },
  { field: "cachedInputTokens", label: "CACHE" }
];

export function SettingsScreen({
  api,
  onAutomations,
  onStartRemoteControl,
  onSignOut
}: SettingsScreenProps) {
  const [requestLogProgress, setRequestLogProgress] = useState<number | null>(null);
  const [requestLogStatus, setRequestLogStatus] = useState<string | null>(null);
  const [selectedTokenTimeframe, setSelectedTokenTimeframe] =
    useState<CodexTokenUsageTimeframe>("1d");
  const [tokenUsage, setTokenUsage] = useState<CodexTokenUsageSummary | null>(null);
  const [tokenUsageStatus, setTokenUsageStatus] = useState<string | null>(null);
  const [isLoadingTokenUsage, setIsLoadingTokenUsage] = useState(true);
  const isRequestingLog = requestLogProgress !== null;
  const selectedTokenUsage = tokenUsage?.timeframes[selectedTokenTimeframe] ?? null;

  useEffect(() => {
    let cancelled = false;

    setIsLoadingTokenUsage(true);
    setTokenUsageStatus(null);
    setTokenUsage(null);
    api
      .getCodexTokenUsage()
      .then((summary) => {
        if (!cancelled) {
          setTokenUsage(summary);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTokenUsageStatus(error instanceof Error ? error.message : "Unable to load tokens");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingTokenUsage(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

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
      <ScrollView
        contentContainerStyle={styles.settingsPanel}
        showsVerticalScrollIndicator={false}
        style={styles.settingsScroll}
      >
        <Text accessibilityRole="header" style={styles.brand}>
          ABITAT
        </Text>
        <View style={styles.tokenUsagePanel}>
          <View style={styles.tokenUsageTopRow}>
            <Text style={styles.tokenUsageTitle}>TOKENS</Text>
            {isLoadingTokenUsage ? (
              <ActivityIndicator color="rgba(255,255,255,0.68)" size="small" />
            ) : (
              <Text style={styles.tokenUsageState}>
                {tokenUsageStatus ? "UNAVAILABLE" : "UPDATED"}
              </Text>
            )}
          </View>
          <View style={styles.tokenTimeframeControl}>
            {TOKEN_USAGE_TIMEFRAMES.map((timeframe) => {
              const selected = timeframe.key === selectedTokenTimeframe;
              return (
                <Pressable
                  accessibilityLabel={`Show ${timeframe.label} token usage`}
                  accessibilityRole="button"
                  key={timeframe.key}
                  onPress={() => setSelectedTokenTimeframe(timeframe.key)}
                  style={({ pressed }) => [
                    styles.tokenTimeframeButton,
                    selected ? styles.tokenTimeframeButtonSelected : null,
                    pressed ? styles.buttonPressed : null
                  ]}
                >
                  <Text
                    style={[
                      styles.tokenTimeframeText,
                      selected ? styles.tokenTimeframeTextSelected : null
                    ]}
                  >
                    {timeframe.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {selectedTokenUsage ? (
            <View style={styles.tokenUsageGrid}>
              {TOKEN_USAGE_METRICS.map((metric) => (
                <View key={metric.field} style={styles.tokenUsageMetric}>
                  <Text style={styles.tokenUsageMetricLabel}>{metric.label}</Text>
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    numberOfLines={1}
                    style={styles.tokenUsageMetricValue}
                  >
                    {formatTokenCount(selectedTokenUsage[metric.field])}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.tokenUsageEmptyState}>
              <Text style={styles.tokenUsageEmptyText}>
                {isLoadingTokenUsage ? "LOADING" : "NO TOKEN DATA"}
              </Text>
              {tokenUsageStatus ? (
                <Text numberOfLines={2} style={styles.tokenUsageErrorText}>
                  {tokenUsageStatus}
                </Text>
              ) : null}
            </View>
          )}
        </View>
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
          accessibilityLabel="Open automations"
          accessibilityRole="button"
          onPress={onAutomations}
          style={({ pressed }) => [
            styles.remoteControlButton,
            pressed ? styles.buttonPressed : null
          ]}
        >
          <Feather color="#f5f5f5" name="clock" size={20} />
          <Text style={styles.remoteControlButtonText}>AUTOMATIONS</Text>
          <Feather color="#8b949e" name="chevron-right" size={18} />
        </Pressable>
        <Pressable
          accessibilityLabel="Start remote control"
          accessibilityRole="button"
          onPress={onStartRemoteControl}
          style={({ pressed }) => [
            styles.remoteControlButton,
            pressed ? styles.buttonPressed : null
          ]}
        >
          <Feather color="#f5f5f5" name="monitor" size={20} />
          <Text style={styles.remoteControlButtonText}>START REMOTE CONTROL</Text>
          <Feather color="#8b949e" name="chevron-right" size={18} />
        </Pressable>
        <Pressable
          accessibilityLabel="Disconnect iPhone from Mac"
          accessibilityRole="button"
          onPress={onSignOut}
          style={({ pressed }) => [styles.disconnectButton, pressed ? styles.buttonPressed : null]}
        >
          <Text style={styles.disconnectButtonText}>DISCONNECT</Text>
        </Pressable>
      </ScrollView>
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
  remoteControlButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 272,
    paddingHorizontal: 18
  },
  remoteControlButtonText: {
    color: "#f3f3f3",
    flex: 1,
    fontSize: 12,
    fontWeight: "400",
    letterSpacing: 3,
    lineHeight: 16
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
    gap: 20,
    justifyContent: "center",
    minHeight: "100%",
    paddingVertical: 34
  },
  settingsScroll: {
    alignSelf: "stretch",
    flex: 1
  },
  settingsScreen: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center"
  },
  tokenTimeframeButton: {
    alignItems: "center",
    borderRadius: 4,
    flex: 1,
    height: 30,
    justifyContent: "center"
  },
  tokenTimeframeButtonSelected: {
    backgroundColor: "#f3f3f3"
  },
  tokenTimeframeControl: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 5,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    padding: 3,
    width: "100%"
  },
  tokenTimeframeText: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 14
  },
  tokenTimeframeTextSelected: {
    color: "#050505"
  },
  tokenUsageEmptyState: {
    alignItems: "center",
    gap: 4,
    minHeight: 70,
    justifyContent: "center"
  },
  tokenUsageEmptyText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 16
  },
  tokenUsageErrorText: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 10,
    fontWeight: "400",
    letterSpacing: 0,
    lineHeight: 14,
    maxWidth: 236,
    textAlign: "center"
  },
  tokenUsageGrid: {
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 148,
    width: 236
  },
  tokenUsageTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 20,
    width: "100%"
  },
  tokenUsageMetric: {
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 4,
    borderWidth: 1,
    gap: 4,
    height: 70,
    justifyContent: "center",
    paddingHorizontal: 8,
    width: 112
  },
  tokenUsageMetricLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.1,
    lineHeight: 12
  },
  tokenUsageMetricValue: {
    color: "#f3f3f3",
    fontSize: 22,
    fontWeight: "300",
    letterSpacing: 0,
    lineHeight: 27
  },
  tokenUsagePanel: {
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 6,
    borderWidth: 1,
    gap: 12,
    padding: 12,
    width: 292
  },
  tokenUsageState: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.1,
    lineHeight: 12
  },
  tokenUsageTitle: {
    color: "#f3f3f3",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 2,
    lineHeight: 16
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

function formatTokenCount(value: number) {
  if (value >= 1_000_000_000) {
    return `${formatCompactToken(value / 1_000_000_000)}B`;
  }

  if (value >= 1_000_000) {
    return `${formatCompactToken(value / 1_000_000)}M`;
  }

  if (value >= 10_000) {
    return `${formatCompactToken(value / 1_000)}K`;
  }

  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatCompactToken(value: number) {
  return (value >= 10 ? Math.round(value).toString() : value.toFixed(1)).replace(/\.0$/u, "");
}
