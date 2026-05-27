import { spawn, spawnSync } from "node:child_process";

import electronPath from "electron";
import { createServer } from "vite";

const compile = spawnSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit"
});

if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

const vite = await createServer({
  configFile: new URL("../vite.config.ts", import.meta.url).pathname
});
await vite.listen();
const viteUrl = vite.resolvedUrls?.local[0] ?? "http://127.0.0.1:5174/";

const electron = spawn(String(electronPath), ["."], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    ABITAT_RENDERER_URL: viteUrl
  },
  stdio: "inherit"
});

electron.on("exit", async (code) => {
  await vite.close();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => electron.kill("SIGINT"));
process.on("SIGTERM", () => electron.kill("SIGTERM"));
