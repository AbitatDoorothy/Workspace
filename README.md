# Abitat Workspace

Abitat Workspace is a web-controlled local coding-agent runtime. This scaffold is Phase 0 of the MVP plan: it creates the monorepo, shared package, web app shell, host daemon shell, and baseline lint/test/dev commands.

## Requirements

- Node.js 24 or newer
- pnpm 10.33.0 or newer
- Codex installed and signed in on the Mac
- `cloudflared` on the Mac for off-network iPhone control without another iPhone app
- PostgreSQL running on `localhost:5432` only when developing the web app

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

## Local-First iPhone Control

Core iPhone control is local-first. The Mac runs the Abitat control server, owns Codex execution and state, and issues the short-lived pairing payload. The iPhone stores the paired Mac endpoint and token locally, then calls that Mac directly through Tailscale, a temporary tunnel, or a user-managed endpoint. No Abitat-hosted domain or hosted database is required for pairing, projects, conversations, messages, attachments, or remote control.

Recommended public flow:

```bash
brew install cloudflared
abitat iphone
```

The command starts the Mac-local control server, starts a Cloudflare Quick Tunnel from the Mac, prints a QR/manual pairing payload with the generated `trycloudflare.com` URL, and bridges requests to the local Codex app-server. The iPhone only needs the Abitat app.

Same-Wi-Fi, Tailscale, and manual endpoint modes are still available:

```bash
abitat iphone --transport local
abitat iphone --transport tailscale
abitat iphone --transport manual --endpoint https://your-endpoint.example
```

For local development on this repository, use:

```bash
cd /Users/reece/Desktop/Abitat_Workspace
pnpm iphone
```

From any directory, use the project-directed form instead:

```bash
pnpm --dir /Users/reece/Desktop/Abitat_Workspace iphone
```

The local control server reads projects, conversations, and messages from the Mac's Codex state. Phone messages are sent through the Mac and never write directly to hosted state.

When a Codex conversation starts from the phone, the Mac bridge starts or resumes the local Codex thread. Set `CODEX_APP_SERVER_URL` only when you want to point Abitat at a non-default Codex app-server endpoint.

The hosted web app may still be useful for local dashboard development, but hosted mobile-control APIs are retired and return guidance to run `abitat iphone` on the Mac.

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
