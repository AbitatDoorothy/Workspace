import type { CodexMobileModelSettings, CodexModelOption, CodexReasoningEffort } from "./types";

export const DEFAULT_CODEX_MODEL_SETTINGS: CodexMobileModelSettings = {
  model: "gpt-5.3-codex",
  effort: "medium"
};

export const CODEX_REASONING_EFFORT_LABELS: Record<CodexReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High"
};

export function resolvedModelSettings(
  current: CodexMobileModelSettings,
  models: CodexModelOption[]
): CodexMobileModelSettings {
  const selectedModel =
    models.find((model) => model.id === current.model) ??
    models.find((model) => model.isDefault) ??
    models[0];

  if (!selectedModel) {
    return current;
  }

  return {
    model: selectedModel.id,
    effort: effortForModel(current.effort, selectedModel)
  };
}

export function effortForModel(
  effort: CodexReasoningEffort,
  model: CodexModelOption
): CodexReasoningEffort {
  return model.supportedReasoningEfforts.includes(effort) ? effort : model.defaultReasoningEffort;
}

export function isCodexReasoningEffort(input: unknown): input is CodexReasoningEffort {
  return (
    input === "none" ||
    input === "minimal" ||
    input === "low" ||
    input === "medium" ||
    input === "high" ||
    input === "xhigh"
  );
}
