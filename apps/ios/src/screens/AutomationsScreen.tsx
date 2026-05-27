import { useEffect, useMemo, useState } from "react";
import { Feather } from "@expo/vector-icons";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ApiClient } from "../api/client";
import type {
  CodexAutomationStatus,
  CodexAutomationSummary,
  CodexAutomationWriteInput
} from "../types";

interface AutomationsScreenProps {
  api: ApiClient;
  onBack(): void;
}

interface AutomationDraft {
  cwdsText: string;
  executionEnvironment: string;
  id: string | null;
  kind: string;
  model: string;
  name: string;
  prompt: string;
  reasoningEffort: string;
  rrule: string;
  status: CodexAutomationStatus;
}

const EMPTY_DRAFT: AutomationDraft = {
  cwdsText: "",
  executionEnvironment: "local",
  id: null,
  kind: "cron",
  model: "gpt-5",
  name: "",
  prompt: "",
  reasoningEffort: "medium",
  rrule: "FREQ=HOURLY;INTERVAL=8",
  status: "ACTIVE"
};

export function AutomationsScreen({ api, onBack }: AutomationsScreenProps) {
  const [automations, setAutomations] = useState<CodexAutomationSummary[]>([]);
  const [draft, setDraft] = useState<AutomationDraft>(EMPTY_DRAFT);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const selectedAutomation = useMemo(
    () => automations.find((automation) => automation.id === draft.id) ?? null,
    [automations, draft.id]
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setStatusMessage(null);
    api
      .listCodexAutomations()
      .then((nextAutomations) => {
        if (cancelled) {
          return;
        }
        setAutomations(nextAutomations);
        setDraft(nextAutomations[0] ? draftFromAutomation(nextAutomations[0]) : { ...EMPTY_DRAFT });
        setIsEditing(nextAutomations.length === 0);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : "Unable to load automations");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  async function saveAutomation() {
    if (isSaving || !isEditing) {
      return;
    }

    const input = automationInputFromDraft(draft);
    if (!input.name || !input.prompt || !input.rrule) {
      setStatusMessage("Name, prompt, and schedule are required");
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);
    try {
      const saved = draft.id
        ? await api.updateCodexAutomation(draft.id, input)
        : await api.createCodexAutomation(input);
      setAutomations((current) => upsertAutomation(current, saved));
      setDraft(draftFromAutomation(saved));
      setIsEditing(false);
      setStatusMessage("SAVED AUTOMATION");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to save automation");
    } finally {
      setIsSaving(false);
    }
  }

  function startNewAutomation() {
    setDraft({ ...EMPTY_DRAFT });
    setIsEditing(true);
    setStatusMessage(null);
  }

  function selectAutomation(automation: CodexAutomationSummary) {
    setDraft(draftFromAutomation(automation));
    setIsEditing(false);
    setStatusMessage(null);
  }

  function cancelEditing() {
    if (selectedAutomation) {
      setDraft(draftFromAutomation(selectedAutomation));
      setIsEditing(false);
      setStatusMessage(null);
      return;
    }

    const firstAutomation = automations[0];
    setDraft(firstAutomation ? draftFromAutomation(firstAutomation) : { ...EMPTY_DRAFT });
    setIsEditing(automations.length === 0);
    setStatusMessage(null);
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardShell}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back to dashboard"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onBack}
            style={({ pressed }) => [styles.iconButton, pressed ? styles.buttonPressed : null]}
          >
            <Feather color="#f3f3f3" name="chevron-left" size={22} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>
            AUTOMATIONS
          </Text>
          <Pressable
            accessibilityLabel="New automation"
            accessibilityRole="button"
            onPress={startNewAutomation}
            style={({ pressed }) => [styles.iconButton, pressed ? styles.buttonPressed : null]}
          >
            <Feather color="#f3f3f3" name="plus" size={20} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color="#f3f3f3" />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.automationList}>
              <View style={styles.listTopRow}>
                <Text style={styles.sectionTitle}>LOCAL CODEX</Text>
                <Pressable
                  accessibilityLabel="Create new automation"
                  accessibilityRole="button"
                  onPress={startNewAutomation}
                  style={({ pressed }) => [styles.newButton, pressed ? styles.buttonPressed : null]}
                >
                  <Text style={styles.newButtonText}>NEW AUTOMATION</Text>
                </Pressable>
              </View>
              {automations.length > 0 ? (
                automations.map((automation) => {
                  const selected = automation.id === draft.id;
                  return (
                    <Pressable
                      accessibilityLabel={`Edit ${automation.name}`}
                      accessibilityRole="button"
                      key={automation.id}
                      onPress={() => selectAutomation(automation)}
                      style={({ pressed }) => [
                        styles.automationRow,
                        selected ? styles.automationRowSelected : null,
                        pressed ? styles.buttonPressed : null
                      ]}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          automation.status === "ACTIVE"
                            ? styles.statusDotActive
                            : styles.statusDotPaused
                        ]}
                      />
                      <View style={styles.automationRowText}>
                        <Text numberOfLines={1} style={styles.automationName}>
                          {automation.name}
                        </Text>
                        <Text numberOfLines={1} style={styles.automationMeta}>
                          {automation.status} / {automation.rrule || "NO SCHEDULE"}
                        </Text>
                      </View>
                      <Feather color="rgba(255,255,255,0.42)" name="chevron-right" size={16} />
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.emptyText}>NO AUTOMATIONS</Text>
              )}
            </View>

            <View style={styles.editorPanel}>
              <View style={styles.editorTopRow}>
                <View style={styles.editorTitleRow}>
                  <Text style={styles.sectionTitle}>
                    {selectedAutomation
                      ? isEditing
                        ? "EDIT AUTOMATION"
                        : "AUTOMATION DETAIL"
                      : "NEW AUTOMATION"}
                  </Text>
                  {selectedAutomation ? (
                    <Pressable
                      accessibilityLabel={
                        isEditing ? "Cancel automation editing" : "Edit automation"
                      }
                      accessibilityRole="button"
                      onPress={isEditing ? cancelEditing : () => setIsEditing(true)}
                      style={({ pressed }) => [
                        styles.editButton,
                        pressed ? styles.buttonPressed : null
                      ]}
                    >
                      <Text style={styles.editButtonText}>{isEditing ? "CANCEL" : "EDIT"}</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.statusToggle}>
                  {(["ACTIVE", "PAUSED"] as const).map((status) => {
                    const selected = draft.status === status;
                    return (
                      <Pressable
                        accessibilityLabel={`Set automation ${status}`}
                        accessibilityRole="button"
                        disabled={!isEditing}
                        key={status}
                        onPress={() => setDraft((current) => ({ ...current, status }))}
                        style={({ pressed }) => [
                          styles.statusToggleButton,
                          selected ? styles.statusToggleButtonSelected : null,
                          pressed ? styles.buttonPressed : null,
                          !isEditing ? styles.inputDisabled : null
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusToggleText,
                            selected ? styles.statusToggleTextSelected : null
                          ]}
                        >
                          {status}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <AutomationInput
                editable={isEditing}
                label="NAME"
                onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
                value={draft.name}
              />
              <AutomationInput
                editable={isEditing}
                label="SCHEDULE"
                onChangeText={(rrule) => setDraft((current) => ({ ...current, rrule }))}
                value={draft.rrule}
              />
              <View style={styles.fieldGrid}>
                <AutomationInput
                  editable={isEditing}
                  label="MODEL"
                  onChangeText={(model) => setDraft((current) => ({ ...current, model }))}
                  value={draft.model}
                />
                <AutomationInput
                  editable={isEditing}
                  label="EFFORT"
                  onChangeText={(reasoningEffort) =>
                    setDraft((current) => ({ ...current, reasoningEffort }))
                  }
                  value={draft.reasoningEffort}
                />
              </View>
              <View style={styles.fieldGrid}>
                <AutomationInput
                  editable={isEditing}
                  label="KIND"
                  onChangeText={(kind) => setDraft((current) => ({ ...current, kind }))}
                  value={draft.kind}
                />
                <AutomationInput
                  editable={isEditing}
                  label="ENV"
                  onChangeText={(executionEnvironment) =>
                    setDraft((current) => ({ ...current, executionEnvironment }))
                  }
                  value={draft.executionEnvironment}
                />
              </View>
              <AutomationInput
                editable={isEditing}
                label="WORKSPACES"
                multiline
                onChangeText={(cwdsText) => setDraft((current) => ({ ...current, cwdsText }))}
                value={draft.cwdsText}
              />
              <AutomationInput
                editable={isEditing}
                label="PROMPT"
                multiline
                onChangeText={(prompt) => setDraft((current) => ({ ...current, prompt }))}
                value={draft.prompt}
              />

              <Pressable
                accessibilityLabel="Save automation"
                accessibilityRole="button"
                disabled={isSaving || !isEditing}
                onPress={saveAutomation}
                style={({ pressed }) => [
                  styles.saveButton,
                  pressed ? styles.buttonPressed : null,
                  isSaving || !isEditing ? styles.buttonDisabled : null
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#050505" size="small" />
                ) : (
                  <Text style={styles.saveButtonText}>SAVE AUTOMATION</Text>
                )}
              </Pressable>
              {statusMessage ? (
                <Text numberOfLines={2} style={styles.statusMessage}>
                  {statusMessage}
                </Text>
              ) : null}
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AutomationInput({
  editable,
  label,
  multiline,
  onChangeText,
  value
}: {
  editable: boolean;
  label: string;
  multiline?: boolean;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        editable={editable}
        multiline={multiline}
        onChangeText={(nextValue) => {
          if (editable) {
            onChangeText(nextValue);
          }
        }}
        placeholderTextColor="rgba(255,255,255,0.26)"
        scrollEnabled={multiline}
        selectTextOnFocus={editable}
        selectionColor="#f3f3f3"
        style={[
          styles.textInput,
          multiline ? styles.textInputMultiline : null,
          !editable ? styles.textInputReadonly : null
        ]}
        value={value}
      />
    </View>
  );
}

function draftFromAutomation(automation: CodexAutomationSummary): AutomationDraft {
  return {
    cwdsText: automation.cwds.join("\n"),
    executionEnvironment: automation.executionEnvironment,
    id: automation.id,
    kind: automation.kind,
    model: automation.model,
    name: automation.name,
    prompt: automation.prompt,
    reasoningEffort: automation.reasoningEffort,
    rrule: automation.rrule,
    status: automation.status
  };
}

function automationInputFromDraft(draft: AutomationDraft): CodexAutomationWriteInput {
  return {
    cwds: draft.cwdsText
      .split(/\r?\n/u)
      .map((cwd) => cwd.trim())
      .filter(Boolean),
    executionEnvironment: draft.executionEnvironment.trim() || "local",
    kind: draft.kind.trim() || "cron",
    model: draft.model.trim() || "gpt-5",
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    reasoningEffort: draft.reasoningEffort.trim() || "medium",
    rrule: draft.rrule.trim(),
    status: draft.status
  };
}

function upsertAutomation(automations: CodexAutomationSummary[], saved: CodexAutomationSummary) {
  const withoutSaved = automations.filter((automation) => automation.id !== saved.id);
  return [saved, ...withoutSaved].sort(
    (left, right) =>
      (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0) ||
      left.name.localeCompare(right.name)
  );
}

const styles = StyleSheet.create({
  automationList: {
    borderColor: "rgba(255,255,255,0.13)",
    borderRadius: 6,
    borderWidth: 1,
    gap: 8,
    padding: 12
  },
  automationMeta: {
    color: "rgba(255,255,255,0.44)",
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0,
    lineHeight: 14
  },
  automationName: {
    color: "#f3f3f3",
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0,
    lineHeight: 17
  },
  automationRow: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 5,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  automationRowSelected: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.22)"
  },
  automationRowText: {
    flex: 1,
    minWidth: 0
  },
  buttonDisabled: {
    opacity: 0.7
  },
  buttonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.99 }]
  },
  editorPanel: {
    borderColor: "rgba(255,255,255,0.13)",
    borderRadius: 6,
    borderWidth: 1,
    gap: 12,
    padding: 12
  },
  editorTopRow: {
    gap: 10
  },
  editorTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  editButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 4,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    minWidth: 68,
    paddingHorizontal: 10
  },
  editButtonText: {
    color: "#f3f3f3",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    lineHeight: 13
  },
  emptyText: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    lineHeight: 16,
    paddingVertical: 12,
    textAlign: "center"
  },
  fieldGrid: {
    flexDirection: "row",
    gap: 10
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: 14
  },
  iconButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 4,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  inputGroup: {
    flex: 1,
    gap: 6
  },
  inputLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.1,
    lineHeight: 12
  },
  inputDisabled: {
    opacity: 0.58
  },
  keyboardShell: {
    flex: 1
  },
  listTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between"
  },
  loadingState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  newButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 4,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    paddingHorizontal: 10
  },
  newButtonText: {
    color: "#f3f3f3",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.1,
    lineHeight: 12
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: "#f3f3f3",
    borderRadius: 4,
    height: 46,
    justifyContent: "center"
  },
  saveButtonText: {
    color: "#050505",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.8,
    lineHeight: 16
  },
  screen: {
    backgroundColor: "#000000",
    flex: 1
  },
  scrollContent: {
    gap: 14,
    paddingBottom: 32,
    paddingHorizontal: 14
  },
  sectionTitle: {
    color: "#f3f3f3",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.6,
    lineHeight: 16
  },
  statusDot: {
    borderRadius: 5,
    height: 10,
    width: 10
  },
  statusDotActive: {
    backgroundColor: "#ff4b4b"
  },
  statusDotPaused: {
    backgroundColor: "rgba(255,255,255,0.34)"
  },
  statusMessage: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0,
    lineHeight: 15,
    minHeight: 16,
    textAlign: "center"
  },
  statusToggle: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 5,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    padding: 3
  },
  statusToggleButton: {
    alignItems: "center",
    borderRadius: 4,
    flex: 1,
    height: 30,
    justifyContent: "center"
  },
  statusToggleButtonSelected: {
    backgroundColor: "#f3f3f3"
  },
  statusToggleText: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 13
  },
  statusToggleTextSelected: {
    color: "#050505"
  },
  textInput: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 4,
    borderWidth: 1,
    color: "#f3f3f3",
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 0,
    lineHeight: 18,
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  textInputMultiline: {
    minHeight: 92,
    textAlignVertical: "top"
  },
  textInputReadonly: {
    backgroundColor: "rgba(255,255,255,0.035)",
    color: "rgba(255,255,255,0.7)"
  },
  title: {
    color: "#f3f3f3",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 2.4,
    lineHeight: 20
  }
});
