export function isTerminalUpgradePath(requestUrl: string | undefined) {
  const pathname = requestPathname(requestUrl);

  return pathname.startsWith("/api/conversations/") && pathname.endsWith("/terminal");
}

function requestPathname(requestUrl: string | undefined) {
  try {
    return new URL(requestUrl ?? "/", "http://localhost").pathname;
  } catch {
    return "";
  }
}
