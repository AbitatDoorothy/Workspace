import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface HostConfig {
  apiUrl: string;
  hostToken: string;
  machineId: string;
  workspaceId: string;
}

export function defaultConfigPath() {
  return join(homedir(), ".abitat-host", "config.json");
}

export async function loadHostConfig(path = defaultConfigPath()) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as HostConfig;
}

export async function saveHostConfig(config: HostConfig, path = defaultConfigPath()) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
