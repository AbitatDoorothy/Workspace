import { app, BrowserWindow, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { registerDesktopIpc } from "./ipc.js";
import { startDesktopRuntime, type DesktopRuntime } from "./runtime.js";

let mainWindow: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let ipcRegistered = false;

const mainDir = dirname(fileURLToPath(import.meta.url));

process.on("uncaughtException", (error) => {
  console.error("[abitat] uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  console.error("[abitat] unhandled rejection", error);
});

async function ensureRuntime() {
  if (runtime) {
    return runtime;
  }

  runtime = await startDesktopRuntime({
    openPath: async (path) => {
      const error = await shell.openPath(path);
      if (error) {
        throw new Error(error);
      }
    },
    revealPath: async (path) => {
      shell.showItemInFolder(path);
    }
  });
  if (!ipcRegistered) {
    registerDesktopIpc(runtime.api);
    ipcRegistered = true;
  }

  return runtime;
}

async function createMainWindow() {
  await ensureRuntime();

  mainWindow = new BrowserWindow({
    backgroundColor: "#000000",
    height: 900,
    minHeight: 680,
    minWidth: 1080,
    show: true,
    title: "Abitat",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(mainDir, "../preload.js"),
      sandbox: false
    },
    width: 1320
  });
  showMainWindow();

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error("[abitat] renderer failed to load", errorCode, errorDescription);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    showMainWindow();
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[abitat] renderer process gone", details);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const rendererUrl = process.env.ABITAT_RENDERER_URL;
  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
    showMainWindow();
    return;
  }

  await mainWindow.loadURL(pathToFileURL(join(mainDir, "../renderer/index.html")).toString());
  showMainWindow();
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  app.focus({ steal: true });
  setTimeout(() => mainWindow?.setVisibleOnAllWorkspaces(false), 1500).unref();
}

app
  .whenReady()
  .then(async () => {
    await createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error("[abitat] startup failed", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (!runtime) {
    return;
  }

  event.preventDefault();
  const activeRuntime = runtime;
  runtime = null;
  activeRuntime
    .close()
    .catch(() => undefined)
    .finally(() => app.quit());
});
