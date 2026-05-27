import { createServer } from "node:net";
import { readFile, stat } from "node:fs/promises";

import QRCode from "qrcode";

import {
  createLocalCodexBridge,
  createLocalCodexCompletionNotifier,
  createLocalControlStore,
  createLocalMobilePushService,
  createMobileControlDiagnosticsLogger,
  createCodexAutomation,
  listCodexAutomations,
  mobileControlDiagnosticsLogPath,
  readCodexTokenUsageSummary,
  startLocalControlServer,
  startRelayClient,
  updateCodexAutomation,
  type CodexTokenUsageSummary,
  type LocalCodexBridge,
  type LocalControlStore
} from "@abitat_reece/host-daemon/local-control";

import type {
  DesktopApi,
  DesktopDiagnosticsLog,
  DesktopPairingPayload,
  DesktopRuntimeStatus,
  DesktopTokenUsageSummary
} from "../shared/types.js";

interface DesktopRuntimeApiOptions {
  automationsDirectory?: string;
  codex: LocalCodexBridge;
  createQrDataUrl?: (payload: string) => Promise<string>;
  diagnosticsLogLimitBytes?: number;
  diagnosticsLogPath: string;
  getStatus(): Promise<DesktopRuntimeStatus>;
  openPath?: (path: string) => Promise<void>;
  revealPath?: (path: string) => Promise<void>;
  store: Pick<LocalControlStore, "createPairing">;
  tokenUsageProvider?: () => Promise<CodexTokenUsageSummary>;
}

export interface StartDesktopRuntimeOptions {
  codexBinaryPath?: string;
  codexServerUrl?: string;
  endpoint?: string;
  now?: () => Date;
  openPath?: (path: string) => Promise<void>;
  port?: number;
  relayEndpoint?: string;
  revealPath?: (path: string) => Promise<void>;
}

export interface DesktopRuntime {
  api: DesktopApi;
  close(): Promise<void>;
}

const DEFAULT_DIAGNOSTICS_LOG_LIMIT_BYTES = 3 * 1024 * 1024;
const DEFAULT_LOCAL_CONTROL_PORT = 3901;
const DEFAULT_RELAY_ENDPOINT = "https://workspace.abitat.io";

export function createDesktopRuntimeApi(options: DesktopRuntimeApiOptions): DesktopApi {
  const createQrDataUrl = options.createQrDataUrl ?? defaultQrDataUrl;
  const tokenUsageProvider = options.tokenUsageProvider ?? readCodexTokenUsageSummary;

  return {
    continueConversation(conversationId, input) {
      return options.codex.continueConversation(conversationId, input);
    },
    createAutomation(input) {
      return createCodexAutomation({ rootDir: options.automationsDirectory }, input);
    },
    async createPhonePairing(): Promise<DesktopPairingPayload> {
      const status = await options.getStatus();
      const pairing = await options.store.createPairing({
        endpoint: status.endpoint,
        relayId: status.relayId,
        transport: "relay"
      });
      const payloadJson = JSON.stringify(pairing);

      return {
        expiresAt: pairing.expiresAt,
        manualCode: pairing.manualCode,
        payloadJson,
        qrDataUrl: await createQrDataUrl(payloadJson),
        relayId: pairing.relayId
      };
    },
    downloadGeneratedFile(conversationId, fileId) {
      return options.codex.downloadGeneratedFile(conversationId, fileId);
    },
    getDiagnosticsLog() {
      return readDiagnosticsLog(
        options.diagnosticsLogPath,
        options.diagnosticsLogLimitBytes ?? DEFAULT_DIAGNOSTICS_LOG_LIMIT_BYTES
      );
    },
    getStatus() {
      return options.getStatus();
    },
    async getTokenUsage(): Promise<DesktopTokenUsageSummary> {
      return mapTokenUsage(await tokenUsageProvider());
    },
    listAutomations() {
      return listCodexAutomations({ rootDir: options.automationsDirectory });
    },
    listCompletionStates() {
      return options.codex.listCompletionStates();
    },
    listConversations(projectId) {
      return options.codex.listProjectConversations(projectId);
    },
    listGeneratedFiles(conversationId) {
      return options.codex.listGeneratedFiles(conversationId);
    },
    listMessages(conversationId, messageOptions) {
      return options.codex.listMessages(conversationId, messageOptions);
    },
    listModelOptions() {
      return options.codex.listModelOptions();
    },
    listProjects() {
      return options.codex.listProjects();
    },
    async openPath(path) {
      if (!options.openPath) {
        throw new Error("Opening files is unavailable in this runtime");
      }
      await options.openPath(path);
    },
    async revealPath(path) {
      if (!options.revealPath) {
        throw new Error("Revealing files is unavailable in this runtime");
      }
      await options.revealPath(path);
    },
    startConversation(projectId, input) {
      return options.codex.startConversation(projectId, input);
    },
    updateAutomation(automationId, input) {
      return updateCodexAutomation({ rootDir: options.automationsDirectory }, automationId, input);
    }
  };
}

export async function startDesktopRuntime(
  options: StartDesktopRuntimeOptions = {}
): Promise<DesktopRuntime> {
  const diagnosticsLogPath = mobileControlDiagnosticsLogPath();
  const diagnostics = createMobileControlDiagnosticsLogger({ logPath: diagnosticsLogPath });
  const store = createLocalControlStore();
  const relayEndpoint =
    options.relayEndpoint ?? process.env.ABITAT_RELAY_ENDPOINT ?? DEFAULT_RELAY_ENDPOINT;
  const localPort = await findAvailablePort(
    options.port ?? Number(process.env.ABITAT_LOCAL_CONTROL_PORT ?? DEFAULT_LOCAL_CONTROL_PORT)
  );
  const localEndpoint = `http://127.0.0.1:${localPort}`;
  const publicEndpoint = options.endpoint ?? relayEndpoint;
  const relayId = await store.getRelayId();
  const codex = createLocalCodexBridge({
    codexBinaryPath: options.codexBinaryPath ?? process.env.CODEX_APP_BINARY ?? "codex",
    diagnostics,
    serverUrl: options.codexServerUrl ?? process.env.CODEX_APP_SERVER_URL ?? "stdio://"
  });
  const server = await startLocalControlServer({
    bindHost: "127.0.0.1",
    codex,
    diagnostics,
    endpoint: localEndpoint,
    port: localPort,
    store,
    transport: "relay"
  });
  const relayClient = startRelayClient({
    diagnostics,
    localEndpoint: server.endpoint,
    relayEndpoint,
    relayId,
    store
  });
  const stopCompletionNotifier = createLocalCodexCompletionNotifier({
    codex,
    diagnostics,
    logger: console,
    mobilePushService: createLocalMobilePushService(store, { diagnostics, logger: console })
  }).start();
  const serverStartedAt = (options.now ?? (() => new Date()))().toISOString();

  async function getStatus(): Promise<DesktopRuntimeStatus> {
    const identity = await store.getMacIdentity();
    const codexStatus = await codex.bootstrap().catch((error: unknown) => ({
      available: false,
      error: error instanceof Error ? error.message : String(error)
    }));

    return {
      codex: codexStatus,
      diagnosticsLogPath,
      endpoint: publicEndpoint,
      localEndpoint: server.endpoint,
      macId: identity.macId,
      macName: identity.macName,
      relayConnected: true,
      relayEndpoint,
      relayId,
      serverStartedAt,
      transport: "relay"
    };
  }

  return {
    api: createDesktopRuntimeApi({
      codex,
      diagnosticsLogPath,
      getStatus,
      openPath: options.openPath,
      revealPath: options.revealPath,
      store
    }),
    async close() {
      stopCompletionNotifier();
      relayClient.close();
      await server.close();
    }
  };
}

export async function readDiagnosticsLog(
  logPath: string,
  limitBytes = DEFAULT_DIAGNOSTICS_LOG_LIMIT_BYTES
): Promise<DesktopDiagnosticsLog> {
  try {
    const stats = await stat(logPath);
    const totalSize = stats.size;
    const truncated = totalSize > limitBytes;
    const bytes = await readFile(logPath);
    const slice = truncated ? bytes.subarray(bytes.byteLength - limitBytes) : bytes;

    return {
      data: slice.toString("utf8"),
      logPath,
      size: totalSize,
      truncated
    };
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      return {
        data: "",
        logPath,
        size: 0,
        truncated: false
      };
    }
    throw error;
  }
}

function mapTokenUsage(summary: CodexTokenUsageSummary): DesktopTokenUsageSummary {
  return {
    generatedAt: summary.generatedAt,
    timeframes: {
      "1d": summary.oneDay,
      "7d": summary.sevenDays,
      all: summary.allTime
    }
  };
}

async function defaultQrDataUrl(payload: string) {
  return QRCode.toDataURL(payload, {
    color: {
      dark: "#f3f3f3",
      light: "#000000"
    },
    margin: 1,
    width: 320
  });
}

function findAvailablePort(startPort: number) {
  const firstPort = Number.isInteger(startPort) && startPort > 0 ? startPort : 0;
  const maxPort = firstPort === 0 ? 0 : firstPort + 20;

  async function tryPort(port: number): Promise<number | null> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE" || error.code === "EACCES") {
          resolve(null);
          return;
        }
        reject(error);
      });
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        const resolvedPort = address && typeof address === "object" ? address.port : port;
        server.close((error) => (error ? reject(error) : resolve(resolvedPort)));
      });
    });
  }

  return (async () => {
    if (firstPort === 0) {
      const port = await tryPort(0);
      if (port !== null) {
        return port;
      }
    }

    for (let port = firstPort; port <= maxPort; port += 1) {
      const availablePort = await tryPort(port);
      if (availablePort !== null) {
        return availablePort;
      }
    }

    throw new Error(`No available local-control port found from ${firstPort} to ${maxPort}`);
  })();
}
