import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";

import { codexAppService } from "./server/codex-app";
import { createCodexCompletionNotifier } from "./server/mobile/codex-completion-notifier";
import { mobileService } from "./server/mobile";
import { createMobilePushService } from "./server/mobile/mobile-push-service";
import { createTerminalWss, handleTerminalUpgrade } from "./server/terminal/terminal-relay";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const wss = createTerminalWss();
  const stopCodexCompletionNotifier = createCodexCompletionNotifier({
    codexAppService,
    hostMachineId: process.env.ABITAT_MACHINE_ID ?? "machine_demo",
    mobilePushService: createMobilePushService(mobileService)
  }).start();
  const server = createServer((req, res) => {
    void handle(req, res);
  });

  server.on("upgrade", (request, socket, head) => {
    const pathname = parse(request.url ?? "").pathname ?? "";

    if (pathname.startsWith("/api/conversations/") && pathname.endsWith("/terminal")) {
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
