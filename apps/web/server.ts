import { createServer } from "node:http";
import next from "next";

import { codexAppService } from "./server/codex-app";
import { createCodexCompletionNotifier } from "./server/mobile/codex-completion-notifier";
import { mobileService } from "./server/mobile";
import { mobileActivityLog } from "./server/mobile/mobile-activity-log";
import { createMobilePushService } from "./server/mobile/mobile-push-service";
import { createTerminalWss, handleTerminalUpgrade } from "./server/terminal/terminal-relay";
import { isTerminalUpgradePath } from "./server/terminal/upgrade-path";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const wss = createTerminalWss();
  console.log(`[mobile-activity] Writing mobile activity logs to ${mobileActivityLog.filePath}`);
  const stopCodexCompletionNotifier = createCodexCompletionNotifier({
    activityLog: mobileActivityLog,
    codexAppService,
    hostMachineId: process.env.ABITAT_MACHINE_ID ?? "machine_demo",
    logger: console,
    mobilePushService: createMobilePushService(mobileService, {
      activityLog: mobileActivityLog,
      logger: console
    })
  }).start();
  const server = createServer((req, res) => {
    void handle(req, res);
  });

  server.on("upgrade", (request, socket, head) => {
    if (isTerminalUpgradePath(request.url)) {
      void handleTerminalUpgrade(request, socket, head, wss);
      return;
    }

    socket.destroy();
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });

  const shutdown = () => {
    stopCodexCompletionNotifier();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1_000).unref();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
});
