# Hosted Deployment

`workspace.abitat.io` must run the web app and API with persistent database storage. Public Mac and iPhone clients should use this hosted URL by default.

## Required Environment

```text
DATABASE_URL
DIRECT_URL
ABITAT_SESSION_SECRET
ABITAT_PUBLIC_URL=https://workspace.abitat.io
EXPO_ACCESS_TOKEN or production push notification credentials
APPLE_TEAM_ID/APNs configuration for production iPhone builds
```

`DATABASE_URL` must point to hosted Postgres. Do not use a `localhost` database for Cloudflare Workers.
For Supabase, set `DATABASE_URL` to the pooled connection string, usually the port `6543` URL with `?pgbouncer=true`.
Set `DIRECT_URL` locally or in deployment CI to the direct or session-pooler connection string, usually the port `5432` URL, so Prisma migrations can run outside PgBouncer transaction pooling. Prisma ORM 7 does not support `directUrl`; this repo's Prisma config uses `DIRECT_URL` as the CLI datasource URL when it is present, while the web runtime continues to use `DATABASE_URL`.

Set production secrets in Cloudflare before deploying:

```bash
cd apps/web
wrangler secret put DATABASE_URL
wrangler secret put ABITAT_SESSION_SECRET
```

Run migrations against the hosted database before the first production cutover:

```bash
DATABASE_URL="<supabase-pooled-url>" DIRECT_URL="<supabase-direct-or-session-url>" pnpm --filter web db:migrate
```

## Required Behaviors

- Account registration and login must be enabled.
- CLI device login routes must be publicly reachable.
- Host registration must require a valid CLI token.
- Pairing codes must be scoped to the signed-in account workspace.
- Mobile API requests must route phone-started Codex jobs to the paired Mac host.
- The host daemon must connect outbound to the hosted API; the hosted API must not require inbound access to the Mac.

## Release Checks

After deploying, verify the hosted API with:

```bash
curl https://workspace.abitat.io/api/health
```

The response must include `"ok":true` and `"database":"ok"` before local development tunnels are stopped.

Before publishing a public CLI or iPhone build, run the full project verification suite and complete the manual acceptance checklist in `docs/acceptance/public-hosted-mobile-control.md`.
