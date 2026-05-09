import net from "node:net";

export const DEFAULT_CODEX_APP_SERVER_URL = "ws://127.0.0.1:47777";
export const DEFAULT_IPHONE_LOGIN_PASSWORD = "abitat-local";
export const DEFAULT_MACHINE_ID = "machine_demo";
export const DEFAULT_WEB_HOST = "0.0.0.0";
export const DEFAULT_WEB_PORT = "3000";

export function applyEnvFile(raw, baseEnv = {}) {
  const env = { ...baseEnv };

  for (const line of raw.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());

    if (!match || env[match[1]]) {
      continue;
    }

    env[match[1]] = match[2].replace(/^"|"$/gu, "");
  }

  return env;
}

export function createIphoneLauncherBaseEnv({ envFile = "", shellEnv = {} } = {}) {
  const merged = envFile ? applyEnvFile(envFile, shellEnv) : { ...shellEnv };

  return {
    ...merged,
    ABITAT_LOGIN_PASSWORD: shellEnv.ABITAT_LOGIN_PASSWORD ?? DEFAULT_IPHONE_LOGIN_PASSWORD
  };
}

export function selectLanAddress(interfaces) {
  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses ?? []).map((address) => ({ ...address, name }))
  );
  const preferredNames = ["en0", "en1", "en2", "wlan0", "eth0"];
  const sorted = candidates.sort(
    (left, right) =>
      interfaceRank(left.name, preferredNames) - interfaceRank(right.name, preferredNames)
  );

  return sorted.find(isReachableIPv4)?.address ?? "127.0.0.1";
}

export function createLauncherEnv({ baseEnv, lanAddress }) {
  const port = baseEnv.ABITAT_WEB_PORT ?? baseEnv.PORT ?? DEFAULT_WEB_PORT;
  const publicUrl = baseEnv.ABITAT_PUBLIC_URL ?? `http://${lanAddress}:${port}`;
  const codexServerUrl = baseEnv.CODEX_APP_SERVER_URL ?? DEFAULT_CODEX_APP_SERVER_URL;

  return {
    ...baseEnv,
    ABITAT_ENABLE_LOCAL_CODEX_APP: baseEnv.ABITAT_ENABLE_LOCAL_CODEX_APP ?? "1",
    ABITAT_MACHINE_ID: nonEmptyValue(baseEnv.ABITAT_MACHINE_ID) ?? DEFAULT_MACHINE_ID,
    ABITAT_PUBLIC_URL: publicUrl,
    CODEX_APP_SERVER_URL: codexServerUrl,
    HOSTNAME: baseEnv.ABITAT_WEB_HOST ?? DEFAULT_WEB_HOST,
    PORT: String(port)
  };
}

export function shouldStartRemoteTunnel(env) {
  const mode = env.ABITAT_IPHONE_TUNNEL?.trim().toLowerCase();

  if (mode === "0" || mode === "false" || mode === "off") {
    return false;
  }

  return Boolean(
    env.ABITAT_PUBLIC_URL && (env.ABITAT_EDGE_TUNNEL_TOKEN || env.CLOUDFLARE_TUNNEL_TOKEN)
  );
}

export function createRemoteTunnelEnv({ baseEnv, localOrigin }) {
  return {
    ...baseEnv,
    ABITAT_LOCAL_ORIGIN: localOrigin
  };
}

export function parseWebSocketEndpoint(value) {
  const url = new URL(value);

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Expected a ws:// or wss:// URL, received ${value}`);
  }

  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "wss:" ? 443 : 80))
  };
}

export function parseNextDevLock(raw) {
  try {
    const parsed = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Number.isInteger(parsed.pid) ||
      !Number.isInteger(parsed.port) ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.appUrl !== "string"
    ) {
      return null;
    }

    return {
      appUrl: parsed.appUrl,
      hostname: parsed.hostname,
      pid: parsed.pid,
      port: parsed.port
    };
  } catch {
    return null;
  }
}

export function isTcpPortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function findAvailablePort(startPort, host = "127.0.0.1") {
  let port = Number(startPort);

  while (port < Number(startPort) + 20) {
    if (!(await isTcpPortOpen(host, port))) {
      return port;
    }

    port += 1;
  }

  throw new Error(`No available web port found from ${startPort} to ${port - 1}`);
}

function isReachableIPv4(address) {
  return (
    isIPv4(address) &&
    address.internal !== true &&
    !address.address.startsWith("127.") &&
    !address.address.startsWith("169.254.") &&
    address.address !== "0.0.0.0"
  );
}

function isIPv4(address) {
  return address.family === "IPv4" || address.family === 4;
}

function nonEmptyValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function interfaceRank(name, preferredNames) {
  const rank = preferredNames.indexOf(name);
  return rank === -1 ? preferredNames.length : rank;
}
