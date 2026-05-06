const DEFAULT_ALLOWED_DEV_ORIGINS = ["workspace.abitat.io"];

export function allowedDevOriginsFromEnv(env: Record<string, string | undefined> = process.env) {
  const origins = new Set(DEFAULT_ALLOWED_DEV_ORIGINS);
  const publicUrl = env.ABITAT_PUBLIC_URL?.trim();

  if (publicUrl) {
    try {
      const url = new URL(publicUrl);
      if (url.hostname) {
        origins.add(url.hostname);
      }
      if (url.host) {
        origins.add(url.host);
      }
    } catch {
      origins.add(publicUrl);
    }
  }

  return [...origins];
}
