import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ApiClient } from "../api/client";
import {
  CODEX_REASONING_EFFORT_LABELS,
  effortForModel,
  resolvedModelSettings
} from "../codex-model-settings";
import { colors, sharedStyles } from "../theme";
import type { CodexMobileModelSettings, CodexModelOption, CodexReasoningEffort } from "../types";

interface CodexModelControlsProps {
  api: ApiClient;
  onChange(next: CodexMobileModelSettings): void;
  value: CodexMobileModelSettings;
}

export function CodexModelControls({ api, onChange, value }: CodexModelControlsProps) {
  const [models, setModels] = useState<CodexModelOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .listCodexModels()
      .then((nextModels) => {
        if (!cancelled) {
          setModels(nextModels);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to load Codex models");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  const availableModels = useMemo(() => {
    if (models.length > 0) {
      return models;
    }

    return [
      {
        defaultReasoningEffort: value.effort,
        description: "",
        displayName: value.model,
        id: value.model,
        isDefault: true,
        supportedReasoningEfforts: Object.keys(
          CODEX_REASONING_EFFORT_LABELS
        ) as CodexReasoningEffort[]
      }
    ];
  }, [models, value.effort, value.model]);

  const activeSettings = resolvedModelSettings(value, availableModels);
  const activeModel = availableModels.find((model) => model.id === activeSettings.model);

  useEffect(() => {
    if (activeSettings.model !== value.model || activeSettings.effort !== value.effort) {
      onChange(activeSettings);
    }
  }, [activeSettings.effort, activeSettings.model, onChange, value.effort, value.model]);

  function selectModel(model: CodexModelOption) {
    onChange({
      model: model.id,
      effort: effortForModel(value.effort, model)
    });
  }

  function selectEffort(effort: CodexReasoningEffort) {
    onChange({
      model: activeSettings.model,
      effort
    });
  }

  return (
    <View style={styles.shell}>
      <View style={styles.headerRow}>
        <Text style={sharedStyles.label}>Model</Text>
        <Text numberOfLines={1} style={styles.currentValue}>
          {activeModel?.displayName ?? activeSettings.model}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chipRow}>
          {availableModels.map((model) => {
            const selected = model.id === activeSettings.model;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={model.id}
                onPress={() => selectModel(model)}
                style={[styles.chip, selected ? styles.selectedChip : null]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.chipText, selected ? styles.selectedChipText : null]}
                >
                  {model.displayName}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {activeModel ? (
        <View style={styles.effortRow}>
          {activeModel.supportedReasoningEfforts.map((effort) => {
            const selected = effort === activeSettings.effort;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={effort}
                onPress={() => selectEffort(effort)}
                style={[styles.effortChip, selected ? styles.selectedChip : null]}
              >
                <Text style={[styles.chipText, selected ? styles.selectedChipText : null]}>
                  {CODEX_REASONING_EFFORT_LABELS[effort]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    maxWidth: 180,
    minHeight: 34,
    paddingHorizontal: 10
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 2
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  currentValue: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
    maxWidth: "68%"
  },
  effortChip: {
    alignItems: "center",
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 10
  },
  effortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700"
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  selectedChip: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  selectedChipText: {
    color: colors.surface
  },
  shell: {
    gap: 8
  }
});
