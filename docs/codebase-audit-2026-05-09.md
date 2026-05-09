# Codebase Audit - 2026-05-09

## Executive Summary

This audit reviewed the current Abitat Workspace monorepo for redundancies, performance bottlenecks, runtime errors, and database portability risks. No source code was changed as part of this review.

The codebase is structurally coherent and the main typecheck/test suites pass. The most important issues are not compile failures; they are runtime and architecture risks around multi-user authorization, non-transactional database operations, polling-heavy synchronization, and local filesystem state inside a Cloudflare-hosted app.

The strongest conclusion for the Supabase/D1 question is that the current app is not a direct lift-and-shift candidate for Cloudflare D1. The web app is implemented as a PostgreSQL Prisma app using `@prisma/adapter-pg`, Postgres migrations, JSONB columns, enums, and Hyperdrive. Moving to D1 would mean a deliberate SQLite/D1 schema and data-access rewrite, not just changing an environment variable.

## Scope

Reviewed areas:

- `apps/web`: Next.js/OpenNext API, Prisma/Postgres access, Cloudflare Worker config, auth, pairing, host/mobile APIs, queueing, remote control, SSE streams.
- `apps/host-daemon`: local Mac daemon runtime, transport, Codex snapshot and remote-control integration.
- `apps/ios`: Expo/React Native iPhone app, polling, pairing, mobile control screens.
- `apps/cli`: public CLI and iPhone launcher flow.
- `apps/mac-remote-helper`: Swift helper for screen capture and input relay.
- `packages/shared`: shared schemas and package checks.
- `workers`, `scripts`, `Formula`, and `docs`.

## Verification Run

Passing checks observed during the audit:

- `pnpm --filter web typecheck`
- `pnpm --filter @abitat_reece/host-daemon typecheck`
- `pnpm --filter @abitat_reece/cli typecheck`
- `pnpm --filter @abitat_reece/shared typecheck`
- `pnpm --filter abitat-ios typecheck`
- `pnpm --filter abitat-ios test`
- `pnpm --filter web test -- --runInBand`
- `pnpm --filter @abitat_reece/host-daemon test`
- `pnpm --filter @abitat_reece/cli test`
- `pnpm --filter @abitat_reece/shared test`
- `pnpm --filter web db:validate`
- `git diff --check`

Failing check:

- `pnpm test:homebrew` fails because `Formula/abitat.rb` references CLI tarball `0.1.3`, while `apps/cli/package.json` is at `0.1.5`. The validator expects `https://registry.npmjs.org/@abitat_reece/cli/-/cli-0.1.5.tgz`.

## Repository Structure

The repository is a pnpm monorepo with these main pieces:

- `apps/web`: hosted control plane, database, API routes, Cloudflare OpenNext deployment.
- `apps/host-daemon`: Mac-side daemon that talks outbound to the hosted API.
- `apps/cli`: installable CLI used for login and iPhone setup.
- `apps/ios`: iPhone app.
- `apps/mac-remote-helper`: Swift helper for screen and input control.
- `packages/shared`: zod schemas and shared package metadata.
- `workers`: legacy/current worker utilities.
- `scripts`, `Formula`, `docs`: deployment, validation, release, and user-facing material.

Large generated or local-state directories are present on disk but are ignored by git:

- `apps/web/.next` - about 1.7 GB.
- `apps/web/.open-next` - about 151 MB.
- `apps/web/.data` - about 20 MB.
- `apps/ios/ios/build` - about 764 MB.
- `apps/ios/ios/Pods` - about 463 MB.
- `apps/mac-remote-helper/.build` - about 91 MB.
- `node_modules` - about 1.8 GB.

`git ls-files` did not show these generated directories as tracked. The size is mainly a local disk/cleanup concern, except for `.data`, which has a stronger deployment/privacy implication described below.

## High Severity Findings

### H1. Workspace authorization is still demo-only

Evidence:

- [`apps/web/server/auth/role-checks.ts`](../apps/web/server/auth/role-checks.ts#L6) only permits `workspace_demo` with `user_demo`.
- Core services call this helper for conversation creation/continuation/labels/deletion and review approval, for example [`apps/web/server/conversations/conversation-queue-service.ts`](../apps/web/server/conversations/conversation-queue-service.ts#L182) and [`apps/web/server/reviews/review-service.ts`](../apps/web/server/reviews/review-service.ts#L111).

Impact:

Real registered users can create account/workspace records, but service-level authorization still rejects any non-demo workspace/user combination in several important flows. This conflicts directly with the goal of making the hosted app usable by other users.

Recommendation:

Replace this helper with a real membership lookup against `WorkspaceMember`, and make browser/API routes pass a server-derived actor instead of trusting or defaulting request-body user ids.

### H2. Browser conversation routes use request-body/default user ids

Evidence:

- [`approve/route.ts`](../apps/web/app/api/conversations/%5Bid%5D/approve/route.ts#L9) defaults `approvedByUserId` to `user_demo`.
- [`continue/route.ts`](../apps/web/app/api/conversations/%5Bid%5D/continue/route.ts#L15) defaults `userId` to `user_demo`.
- [`cancel/route.ts`](../apps/web/app/api/conversations/%5Bid%5D/cancel/route.ts#L8), [`delete/route.ts`](../apps/web/app/api/conversations/%5Bid%5D/delete/route.ts#L7), and [`label/route.ts`](../apps/web/app/api/conversations/%5Bid%5D/label/route.ts#L7) follow the same pattern.
- Middleware verifies that browser API requests have a session in [`apps/web/middleware.ts`](../apps/web/middleware.ts#L37), but these route handlers do not derive the user id from that session.

Impact:

The access model is fragile and demo-biased. In the best case, real users hit authorization failures because the default is `user_demo`. In the worse case, once membership checks are expanded, a client-supplied user id could become an authorization bypass.

Recommendation:

For browser routes, call `getRequestAccountContext(request)` or equivalent and remove user ids from request schemas except where an authenticated service-to-service actor genuinely needs to name another user.

### H3. First-request account context creation is not atomic

Evidence:

- [`getAccountContextForUserId`](../apps/web/server/auth/request-session.ts#L45) creates the default workspace, workspace member, and host machine through separate database operations.
- The workspace is created at [`request-session.ts`](../apps/web/server/auth/request-session.ts#L60), the member at [`request-session.ts`](../apps/web/server/auth/request-session.ts#L73), and the host at [`request-session.ts`](../apps/web/server/auth/request-session.ts#L105).

Impact:

Concurrent first requests, retries, or partial failures can leave a user with a workspace but no membership, or a workspace/member but no host. It can also create duplicate default workspaces or hosts if two requests race before either observes the other's insert.

Recommendation:

Use a transaction or an idempotent upsert strategy with unique constraints that represent the intended invariant, such as one default workspace/host per owner where that is the desired model.

### H4. Account registration is not atomic

Evidence:

- [`accountService.register`](../apps/web/server/auth/accounts.ts#L103) creates the user, workspace, and workspace member in three separate operations.

Impact:

A failure after user creation but before workspace/member creation can leave partially registered accounts. This is especially risky in hosted signup flows where users may retry, refresh, or encounter transient database timeouts.

Recommendation:

Wrap registration in a database transaction or use compensating/idempotent writes that can safely be retried.

### H5. Phone pairing completion can be raced

Evidence:

- [`completePhonePairing`](../apps/web/server/mobile/mobile-service.ts#L224) reads a pairing, checks `consumedAt`, creates a phone machine, then marks the pairing consumed at [`mobile-service.ts`](../apps/web/server/mobile/mobile-service.ts#L298).

Impact:

Two concurrent completions with the same valid code can both pass the `consumedAt` check before either update lands. That can create more than one phone machine for one pairing code.

Recommendation:

Atomically consume the pairing first with a conditional update such as `id = pairing.id AND consumedAt IS NULL AND expiresAt > now`, then create the phone in the same transaction if the consume succeeded.

### H6. Session security has production footguns

Evidence:

- [`getSessionSecret`](../apps/web/server/auth/session.ts#L18) falls back to `local-dev-secret` if `ABITAT_SESSION_SECRET` and `NEXTAUTH_SECRET` are missing.
- [`getLoginPassword`](../apps/web/server/auth/session.ts#L14) falls back to `abitat-local`.
- The hosted deployment docs correctly require `ABITAT_SESSION_SECRET` in [`docs/hosting.md`](hosting.md#L7), but the runtime does not fail closed if it is absent.

Impact:

A misconfigured production deployment can silently use a known session secret and default login password. That is acceptable for local development, but dangerous for a public hosted control plane.

Recommendation:

Fail startup or authentication in production when required secrets are missing. Keep local defaults only when `NODE_ENV !== "production"` or an explicit development flag is set.

## Medium Severity Findings

### M1. Daemon job polling filters queued jobs in memory and claims non-atomically

Evidence:

- [`pollNextJob`](../apps/web/server/conversations/conversation-queue-service.ts#L411) fetches all queued jobs for selected types and then uses `.find(...)` to filter by `machineId`.
- The claim is a plain update by id at [`conversation-queue-service.ts`](../apps/web/server/conversations/conversation-queue-service.ts#L427), with no condition that the job is still queued.
- The current schema includes useful indexes such as [`DaemonJob_status_type_createdAt_idx`](../apps/web/prisma/schema.prisma#L343), but the query shape does not fully use machine scoping in SQL.

Impact:

As queued job volume grows, every daemon poll can scan more records than needed. Concurrent host polls can also claim the same job because both can read the same queued row before either update completes.

Recommendation:

Push machine matching into the database query, order deterministically, and claim with a conditional update or transaction. If multiple workers are expected, use a claim pattern that verifies `status = queued` during the update.

### M2. Cancel/delete/recover paths fetch active jobs broadly and filter in JavaScript

Evidence:

- Delete fetches all active jobs at [`conversation-queue-service.ts`](../apps/web/server/conversations/conversation-queue-service.ts#L382) and filters by conversation id in memory.
- Cancel does the same at [`conversation-queue-service.ts`](../apps/web/server/conversations/conversation-queue-service.ts#L529).
- Stale recovery loads machine jobs and filters staleness in memory at [`conversation-queue-service.ts`](../apps/web/server/conversations/conversation-queue-service.ts#L567).

Impact:

These paths become slower with job history and active job count. They also perform many individual updates where a scoped `updateMany` or transaction would be more efficient and consistent.

Recommendation:

Move `conversationId`, `machineId`, and staleness filters into the database query. Prefer `updateMany` for bulk state changes where per-job hooks are not required.

### M3. Event and message sequence assignment is race-prone

Evidence:

- [`run-event-service.ts`](../apps/web/server/run-events/run-event-service.ts#L30) loads all events to compute the next sequence and sorts in JavaScript at [`run-event-service.ts`](../apps/web/server/run-events/run-event-service.ts#L47).
- [`conversation-message-service.ts`](../apps/web/server/conversation-messages/conversation-message-service.ts#L66) reads the latest message and creates the next sequence.
- Prisma enforces unique `(conversationId, sequence)` on both models in [`schema.prisma`](../apps/web/prisma/schema.prisma#L291) and [`schema.prisma`](../apps/web/prisma/schema.prisma#L307).

Impact:

Concurrent appends can compute the same next sequence and fail on the unique constraint. Listing also does avoidable work by sorting in JavaScript after fetching rows.

Recommendation:

Use database ordering for reads. For writes, use an atomic per-conversation sequence mechanism, transaction retry on unique conflict, or a different monotonic id strategy.

### M4. SSE streams poll the backing services on fixed intervals

Evidence:

- Web conversation events stream calls `runEventService.listEvents(id)` every second in [`events/stream/route.ts`](../apps/web/app/api/conversations/%5Bid%5D/events/stream/route.ts#L10).
- Mobile message streams poll every 1.5 seconds in three branches at [`messages/stream/route.ts`](../apps/web/app/api/mobile/conversations/%5Bid%5D/messages/stream/route.ts#L52), [`messages/stream/route.ts`](../apps/web/app/api/mobile/conversations/%5Bid%5D/messages/stream/route.ts#L102), and [`messages/stream/route.ts`](../apps/web/app/api/mobile/conversations/%5Bid%5D/messages/stream/route.ts#L166).

Impact:

Each connected client creates recurring database or host-service load. The web event stream currently reloads all events and filters client-side by `lastSequence`, which is particularly expensive for long-running threads.

Recommendation:

Fetch incrementally with `sequence > lastSequence`, add explicit heartbeat/error/backoff behavior, and consider a push-oriented mechanism for hosted scale.

### M5. The iPhone app polls aggressively

Evidence:

- Conversation messages poll every 1.8 seconds, status every 2.5 seconds, and full refresh every 12 seconds in [`ConversationScreen.tsx`](../apps/ios/src/screens/ConversationScreen.tsx#L52) and [`ConversationScreen.tsx`](../apps/ios/src/screens/ConversationScreen.tsx#L216).
- Project conversations poll every 1.8 seconds in [`ProjectDetailScreen.tsx`](../apps/ios/src/screens/ProjectDetailScreen.tsx#L44).
- Bootstrap polls every 5 seconds in [`mobile-store.ts`](../apps/ios/src/state/mobile-store.ts#L10) and [`mobile-store.ts`](../apps/ios/src/state/mobile-store.ts#L87).

Impact:

One active phone can generate steady background API load. Many active users will multiply database and host load quickly, especially while streams are also active.

Recommendation:

Prefer SSE/WebSocket for active conversation screens, lengthen background polling intervals, pause polling when screens are not focused, and use exponential backoff after failures.

### M6. Remote-control frames are sent through database-backed JSON payloads

Evidence:

- The Swift helper captures a JPEG frame and sends a base64 data URL every 750 ms in [`ScreenFrameRelay.swift`](../apps/mac-remote-helper/Sources/AbitatRemoteHelper/ScreenFrameRelay.swift#L21) and [`ScreenFrameRelay.swift`](../apps/mac-remote-helper/Sources/AbitatRemoteHelper/ScreenFrameRelay.swift#L60).
- The helper polls remote signals every 350 ms in [`AbitatRemoteHelper.swift`](../apps/mac-remote-helper/Sources/AbitatRemoteHelper/AbitatRemoteHelper.swift#L22).
- The iOS remote screen polls signals every 900 ms in [`RemoteControlScreen.tsx`](../apps/ios/src/screens/RemoteControlScreen.tsx#L38).
- `RemoteControlSignal.payloadJson` is stored as JSON in [`schema.prisma`](../apps/web/prisma/schema.prisma#L373).

Impact:

Screen frames are large, frequent, and ephemeral. Storing them as database JSON can create high write volume, table growth, retention/privacy risk, and poor latency compared with a realtime transport.

Recommendation:

Move screen frames off the relational database path. Prefer WebRTC, WebSocket via Durable Objects, or another ephemeral transport. Keep the database for session metadata and durable audit events, not video/frame data.

### M7. Mobile uploads use base64-in-memory and local filesystem storage

Evidence:

- [`saveMobileUpload`](../apps/web/server/mobile/mobile-uploads.ts#L21) decodes the whole base64 body into a `Buffer`.
- Files are written under `process.cwd()/.data/mobile-uploads` in [`mobile-uploads.ts`](../apps/web/server/mobile/mobile-uploads.ts#L34).
- Local `.data/mobile-uploads` files were observed copied into `.next/standalone` and `.open-next/server-functions/default`.

Impact:

The base64 request body is larger than the decoded file, and the whole payload is held in memory. Local filesystem storage is not durable or portable for Cloudflare Workers. Copying uploads into build output can also leak user data and bloat deployments.

Recommendation:

Use direct-to-object storage or server-side streaming to Cloudflare R2/S3. Explicitly exclude `.data` from standalone/OpenNext output and treat local uploads as development-only.

### M8. Host Codex snapshots update a large JSON blob on the Machine row

Evidence:

- Snapshot caps allow up to 80 projects, 80 conversations, 80 messages per conversation, and 4,000 chars per message in [`codex-snapshot-service.ts`](../apps/web/server/hosts/codex-snapshot-service.ts#L48).
- Each snapshot writes `codexAppSnapshot` back into `Machine.capabilitiesJson` at [`codex-snapshot-service.ts`](../apps/web/server/hosts/codex-snapshot-service.ts#L84).

Impact:

The host machine row becomes a hot row with potentially large JSON writes. This can increase write amplification, lock contention, and response times as more hosts and phones sync history.

Recommendation:

Store snapshot entities in normalized tables or a separate snapshot table keyed by host/workspace, with incremental deltas where possible.

### M9. Remote-control session queries can be collapsed

Evidence:

- [`createSession`](../apps/web/server/remote-control/remote-control-service.ts#L85) performs three separate `findFirst` checks for `active`, `requested`, and `connecting`.
- [`pollHostSessions`](../apps/web/server/remote-control/remote-control-service.ts#L129) performs one query per status and flattens the result.

Impact:

This is not the largest bottleneck, but it adds avoidable database round trips on a latency-sensitive feature.

Recommendation:

Use `status: { in: [...] }` queries and a uniqueness/claim strategy if only one active/requested/connecting session per host is allowed.

### M10. Todo storage is synchronous filesystem state

Evidence:

- [`todo-store.ts`](../apps/web/server/todos/todo-store.ts#L1) uses `existsSync`, `readFileSync`, and `writeFileSync`.

Impact:

Synchronous filesystem I/O blocks the Node event loop locally and is not a durable state mechanism for Cloudflare Workers.

Recommendation:

Move todos into the database or mark the feature as local-only. If it remains filesystem-backed locally, use async I/O.

## Redundancy And Cleanup Findings

### R1. Build output contains local app data

Evidence:

- `.gitignore` ignores `apps/web/.data` at [`.gitignore`](../.gitignore#L7).
- Local upload files and `mobile-activity.jsonl` exist under `apps/web/.data`.
- The same `.data` content was observed inside `.next/standalone/apps/web/.data` and `.open-next/server-functions/default/apps/web/.data`.

Impact:

Even though git ignores the files, build output can still contain local user activity and uploaded images. This is a privacy and deployment-bloat risk.

Recommendation:

Exclude `.data` from Next/OpenNext standalone output and add a cleanup check before deploying.

### R2. Generated artifacts are large but ignored

Evidence:

- `.gitignore` covers `.next`, `.open-next`, `.wrangler`, `.data`, `.expo`, `.build`, `dist`, and `node_modules`.
- The largest local generated directories are `apps/web/.next`, `apps/ios/ios/build`, `apps/ios/ios/Pods`, and `apps/mac-remote-helper/.build`.

Impact:

This is mostly local disk overhead. It can slow search/indexing and make workspace operations feel heavy.

Recommendation:

Add a documented cleanup command or script for generated artifacts. Keep this separate from source cleanup so developers do not accidentally remove useful local state.

### R3. Homebrew formula is stale

Evidence:

- [`apps/cli/package.json`](../apps/cli/package.json#L4) is version `0.1.5`.
- [`Formula/abitat.rb`](../Formula/abitat.rb#L4) still references `cli-0.1.3.tgz`.
- [`scripts/validate-homebrew-formula.mjs`](../scripts/validate-homebrew-formula.mjs#L12) derives the expected tarball from the package version.

Impact:

`pnpm test:homebrew` fails, and a public Homebrew install may fetch an older CLI than intended.

Recommendation:

Update the formula URL and sha when the CLI package is published, then rerun `pnpm test:homebrew`.

### R4. Documentation still mixes early-local and hosted assumptions

Evidence:

- [`README.md`](../README.md#L3) still describes the repo as a Phase 0 scaffold and assumes local PostgreSQL at [`README.md`](../README.md#L9).
- [`docs/hosting.md`](hosting.md#L3) correctly describes the hosted `workspace.abitat.io` control plane and hosted Postgres requirement.

Impact:

New users may be confused about whether they should run only a local server, use the hosted workspace, or configure a hosted database.

Recommendation:

Split documentation into clear "local development", "public hosted use", and "self-hosting" paths. This will also help answer why `pnpm iphone` previously worked without the same database setup.

## Cloudflare D1 / Supabase Portability Notes

### Current state

The hosted web app is currently Postgres-oriented:

- Prisma datasource provider is `postgresql` in [`schema.prisma`](../apps/web/prisma/schema.prisma#L5).
- Runtime database access uses `@prisma/adapter-pg` and `pg-cloudflare` in [`server/db/client.ts`](../apps/web/server/db/client.ts#L1).
- The connection source prefers Cloudflare Hyperdrive when available in [`server/db/client.ts`](../apps/web/server/db/client.ts#L11).
- `wrangler.jsonc` binds Hyperdrive, not D1, in [`apps/web/wrangler.jsonc`](../apps/web/wrangler.jsonc#L30).
- Migrations use Postgres constructs such as `CREATE TYPE ... AS ENUM` and `JSONB`, for example [`20260424000000_init/migration.sql`](../apps/web/prisma/migrations/20260424000000_init/migration.sql#L1) and [`20260503000000_add_mobile_remote_control/migration.sql`](../apps/web/prisma/migrations/20260503000000_add_mobile_remote_control/migration.sql#L11).

Official documentation notes:

- Cloudflare's D1 Prisma tutorial uses a D1 binding in `wrangler` and initializes Prisma with `--datasource-provider sqlite`: https://developers.cloudflare.com/d1/tutorials/d1-and-prisma-orm/
- Prisma's D1 documentation says D1 uses the `sqlite` provider and `@prisma/adapter-d1`, and that D1 migration workflows use Wrangler plus `prisma migrate diff`: https://docs.prisma.io/docs/v6/orm/overview/databases/cloudflare-d1
- The same Prisma D1 page currently states that Prisma/D1 transactions are not supported; implicit and explicit transactions are ignored by the D1 adapter.

### Implication

D1 is possible, but this app would need a planned migration. The biggest blockers are not just syntax differences; they are behavioral:

- The app needs stronger atomic operations for signup, account context creation, phone pairing, and job claiming.
- The Prisma D1 adapter currently has transaction limitations, which conflicts with the kinds of atomic fixes this codebase needs.
- Polling-heavy streams and remote-control frame traffic should not be moved wholesale into D1 because they would turn D1 into a high-churn realtime transport.

### Practical path

If the near-term goal is to support more users quickly, the lower-risk path is to keep Postgres/Supabase or another hosted Postgres behind Hyperdrive and fix authorization, atomicity, and polling pressure first.

If the strategic goal is to be Cloudflare-native, split the architecture first:

- Durable control-plane records: D1 may fit after a schema rewrite.
- Realtime coordination: consider Durable Objects/WebSockets.
- Uploads and large binary-ish data: R2.
- Local-only Mac state: keep on the Mac and sync summaries/deltas, not full local artifacts.

## Recommended Next Steps

1. Replace demo-only authorization with real workspace membership checks.
2. Derive browser route actors from the authenticated session, not from request bodies.
3. Make signup, account context creation, pairing completion, and daemon job claiming atomic or idempotent.
4. Reduce database polling by adding incremental queries, longer backoff, and push-based active-screen sync.
5. Move remote-control screen frames off the SQL database path.
6. Move mobile uploads to object storage and exclude `.data` from build output.
7. Decide deliberately between "Postgres + Hyperdrive now" and "D1 rewrite later"; do not treat D1 as a drop-in replacement.
8. Update the Homebrew formula to match CLI `0.1.5`.
9. Add a cleanup script/documentation for ignored generated artifacts.
10. Update docs so local development, hosted use, and self-hosting each have a clear path.

## Notes On Existing Worktree State

The worktree already contained many modified and untracked files before this report was created, including web database/auth/host/mobile changes and several untracked tests/migrations. This audit did not revert or modify those files.

The only intended file addition from this task is this report.
