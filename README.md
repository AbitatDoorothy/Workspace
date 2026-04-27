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
pnpm --filter host-daemon dev:mock
```

Run checks:

```bash
pnpm lint
pnpm test
pnpm format
```

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
