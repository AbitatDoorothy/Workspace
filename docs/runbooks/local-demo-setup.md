# Local Demo Setup

1. Install dependencies with `pnpm install`.
2. Create `.env` files from `.env.example` if needed.
3. Start or migrate the database with `pnpm db:migrate:dev` and `pnpm db:seed`.
4. Start the web app and host daemon with `pnpm dev`.
5. Pair the host, when needed, with `pnpm --filter @abitat_reece/host-daemon dev pair --code ABITAT-123456`.
6. Open `http://localhost:3000`, create or use the demo project and agent, then start a conversation.
7. To run only one side while debugging, use `pnpm dev:web` or `pnpm dev:daemon`.
8. Review the diff, approve commit/push, and watch the conversation move to `pushed`.

For real runtime testing, make sure `codex` or `claude` is installed and visible in the host daemon shell.
