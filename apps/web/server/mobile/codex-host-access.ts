import type { MobileActor } from "./mobile-service";

const DEFAULT_LOCAL_CODEX_HOST_MACHINE_ID = "machine_demo";
const DEFAULT_LOCAL_CLI_CONFIG_PATH = "Library/Application Support/Abitat/config.json";

interface CliSessionFile {
  userId?: unknown;
}

export async function canUseLocalCodexApp(
  actor: Pick<MobileActor, "hostMachineId" | "userId">,
  env: Partial<Record<string, string | undefined>> = process.env
) {
  if (!isLocalCodexAppEnabled(env)) {
    return false;
  }

  const localHostIds = localCodexHostMachineIds(env);

  if (actor.hostMachineId && localHostIds.has(actor.hostMachineId)) {
    return true;
  }

  const localUserId = await localCodexUserId(env);
  return Boolean(actor.userId && localUserId && actor.userId === localUserId);
}

export function localCodexHostMachineIds(
  env: Partial<Record<string, string | undefined>> = process.env
) {
  return new Set(
    [
      env.ABITAT_LOCAL_CODEX_HOST_MACHINE_ID,
      env.ABITAT_MACHINE_ID,
      DEFAULT_LOCAL_CODEX_HOST_MACHINE_ID
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
  );
}

function isLocalCodexAppEnabled(env: Partial<Record<string, string | undefined>>) {
  const value = env.ABITAT_ENABLE_LOCAL_CODEX_APP?.trim().toLowerCase();
  return value === "1" || value === "true";
}

async function localCodexUserId(env: Partial<Record<string, string | undefined>>) {
  const configuredUserId = env.ABITAT_LOCAL_CODEX_USER_ID?.trim();
  if (configuredUserId) {
    return configuredUserId;
  }

  const [{ readFile }, { homedir }, { join }] = await Promise.all([
    import("node:fs/promises"),
    import("node:os"),
    import("node:path")
  ]);
  const configPath = env.ABITAT_CLI_CONFIG_PATH ?? join(homedir(), DEFAULT_LOCAL_CLI_CONFIG_PATH);

  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as CliSessionFile;
    return typeof parsed.userId === "string" && parsed.userId.trim() ? parsed.userId : null;
  } catch {
    return null;
  }
}
