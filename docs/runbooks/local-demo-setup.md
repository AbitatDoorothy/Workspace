# Local Demo Setup

1. Install dependencies with `pnpm install`.
2. Create `.env` files from `.env.example` if needed.
3. Start or migrate the database with `pnpm db:migrate:dev` and `pnpm db:seed`.
4. Start the web app with `pnpm dev`.
5. Pair the host with `pnpm --filter host-daemon dev pair --code ABITAT-123456`.
6. Start the host with `ABITAT_DAEMON_POLL_INTERVAL_MS=2000 pnpm --filter host-daemon dev`.
7. Open `http://localhost:3000`, create or use the demo project and agent, then start a mock conversation.
8. Review the diff, approve commit/push, and watch the conversation move to `pushed`.

For real runtime testing, make sure `codex` or `claude` is installed and visible in the host daemon shell.
