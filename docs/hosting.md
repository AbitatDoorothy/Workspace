# Legacy Hosted Deployment

`workspace.abitat.io` is a legacy hosted dashboard/development deployment target. Public iPhone control is local-first: the Mac runs the control server, issues pairing payloads, and accepts paired-device requests through the selected Mac-side transport. Core mobile control must not depend on this hosted deployment, a hosted account, or a hosted database.

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

- Hosted account registration and login may be enabled for dashboard development.
- Hosted APIs must not be required by `abitat iphone` or the Abitat iPhone app's local-first pairing flow.
- Production mobile pairing must be issued by the Mac-local server.
- Production mobile API requests must be authenticated with Mac-local paired-device tokens.
- Codex execution and state remain owned by the Mac.

## Release Checks

After deploying, verify the hosted API with:

```bash
curl https://workspace.abitat.io/api/health
```

The response must include `"ok":true` and `"database":"ok"` before local development tunnels are stopped.

Before publishing a public CLI or iPhone build, run the full project verification suite and complete the manual acceptance checklist in `docs/acceptance/local-first-mobile-control.md`.
