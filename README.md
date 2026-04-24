# Abitat Workspace

Abitat Workspace is a web-controlled local coding-agent runtime. This scaffold is Phase 0 of the MVP plan: it creates the monorepo, shared package, web app shell, host daemon shell, and baseline lint/test/dev commands.

## Requirements

- Node.js 24 or newer
- pnpm 10.33.0 or newer

## Local Setup

```bash
pnpm install
cp .env.example .env.local
```

## Commands

Start the web app:

```bash
pnpm dev
```

Start the host daemon in mock mode:

```bash
pnpm --filter host-daemon dev
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
