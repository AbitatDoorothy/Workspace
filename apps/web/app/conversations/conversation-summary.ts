import type { RunEventView } from "./chat-events";

export function getLatestConversationSummary(events: RunEventView[], savedSummary?: string | null) {
  const eventSummary = [...events]
    .reverse()
    .find((event) => event.type === "summary" && event.content.trim());

  return cleanConversationSummary(eventSummary?.content ?? savedSummary ?? "");
}

function cleanConversationSummary(summary: string) {
  const trimmed = summary.trim();

  if (
    !trimmed.startsWith("Codex terminal session ended.") ||
    !trimmed.includes("Recent activity:")
  ) {
    return trimmed;
  }

  const recent = trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/u, ""))
    .map(cleanTerminalSummaryLine)
    .filter(isTerminalSummaryLine)
    .slice(-6);

  if (recent.length === 0) {
    return "Codex terminal session ended.";
  }

  return [
    "Codex terminal session ended.",
    "",
    "Recent activity:",
    ...recent.map((line) => `- ${line}`)
  ].join("\n");
}

function cleanTerminalSummaryLine(line: string) {
  let cleaned = line
    .replace(/^[\u2022\-\s]+/u, "")
    .replace(/^[\u2713\u2714]\s*/u, "")
    .trim();

  for (const marker of [" › ", " Token usage:"]) {
    const markerIndex = cleaned.indexOf(marker);
    if (markerIndex > 0) {
      cleaned = cleaned.slice(0, markerIndex).trim();
    }
  }

  return cleaned;
}

function isTerminalSummaryLine(line: string) {
  if (!line || /^recent activity:/iu.test(line)) {
    return false;
  }

  if (/^codex terminal session ended\./iu.test(line) || /to continue this session/iu.test(line)) {
    return false;
  }

  if (/^[\u256d\u2570\u2502\u2500\s]+$/u.test(line) || /^\d+\s+[+-]?/u.test(line)) {
    return false;
  }

  return /^(?:added|changed|completed|created|deleted|edited|fixed|generated|implemented|modified|updated|wrote)\b/iu.test(
    line
  );
}
