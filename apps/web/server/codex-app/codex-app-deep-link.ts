export function codexAppDeepLink(threadId: string) {
  return `codex://threads/${encodeURIComponent(threadId)}`;
}
