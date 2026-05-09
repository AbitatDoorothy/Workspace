# Abitat Workspace

Abitat Workspace is a web-controlled local coding-agent runtime. This scaffold is Phase 0 of the MVP plan: it creates the monorepo, shared package, web app shell, host daemon shell, and baseline lint/test/dev commands.

## Requirements

- Node.js 24 or newer
- pnpm 10.33.0 or newer
- PostgreSQL running on `localhost:5432`

## Local Setup

```bash
pnpm install
cp .env.example .env.local
brew install postgresql@16
brew services start postgresql@16
/opt/homebrew/opt/postgresql@16/bin/createdb abitat_workspace
pnpm db:migrate:dev
pnpm db:seed
```

If your macOS user is not `reece`, update `DATABASE_URL` in `.env.local` to use your local Postgres role.

## Commands

Start the web app and host daemon together:

```bash
pnpm dev
```

Run just the web app:

```bash
pnpm dev:web
```

Run just the host daemon in Codex mode:

```bash
pnpm dev:daemon
```

Run the host daemon in mock mode:

```bash
pnpm --filter @abitat_reece/host-daemon dev:mock
```

Run checks:

```bash
pnpm lint
pnpm test
pnpm format
```

## Cloudflare Workspace

`workspace.abitat.io` is hosted on Cloudflare Workers and uses hosted Postgres for account, pairing, project, and conversation state. Users do not need to run the web app locally to open the mobile control plane.

For the public flow, install and authenticate the CLI, then start the local Mac host daemon:

```bash
abitat login
abitat iphone
```

Open `https://workspace.abitat.io` or the iPhone app, register or log in with the same email account, and pair the phone to the Mac host. The host daemon connects outbound to the hosted API, so the phone and Mac do not need to be on the same Wi-Fi network.

For local development on this repository, use:

```bash
cd /Users/reece/Desktop/Abitat_Workspace
pnpm iphone
```

From any directory, use the project-directed form instead:

```bash
pnpm --dir /Users/reece/Desktop/Abitat_Workspace iphone
```

The daemon uploads the local `git`, `gh`, `node`, `python`, `codex`, and `claude` scan on startup. After that, create projects, agents, and conversations from the web UI.

When a Codex conversation starts, the host daemon opens macOS Terminal and runs the local Codex CLI for the matching web conversation. Continuing a web conversation resumes the stored Codex session instead of creating a new one. Set `ABITAT_CLI_RUNTIME_MODE=inline` only when you want the older hidden CLI runner for debugging.

For debugging the older local relay flow, the split commands still exist as `pnpm cloud:dev` and `pnpm cloud:host`. For legacy Cloudflare Tunnel testing, set `ABITAT_TUNNEL_MODE=cloudflared` before `pnpm cloud`.

## Workspace Structure

```text
apps/
  web/          Next.js app and browser control plane
  host-daemon/  Local host runtime daemon
packages/
  shared/       Shared TypeScript exports for app and daemon
docs/           Plans, architecture notes, and runbooks
```

Phase 1 will add the shared domain schemas and API payload validation.

# Workspace
