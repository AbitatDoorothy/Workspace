# Cloudflare Relay Mobile Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unstable temporary public tunnels with a `workspace.abitat.io` relay that lets each paired iPhone control only the Mac that explicitly paired it.

**Architecture:** The Mac remains the authority for pairing, token minting, token validation, Codex project discovery, conversations, messages, attachments, and remote control. Cloudflare Workers and Durable Objects provide an opaque relay room per Mac pairing route; relay rooms forward encrypted envelopes between the iPhone and the Mac's outbound WebSocket but cannot mint tokens or authorize Codex actions. Core mobile control remains free of Supabase/Postgres/Prisma/hosted workspace state.

**Tech Stack:** TypeScript, pnpm workspace packages, Cloudflare Workers, Durable Objects, WebSockets, Web Crypto/Node crypto compatible AES-GCM envelopes, Vitest, existing host-daemon local-control APIs, existing iOS API client and SecureStore state.

---

## Acceptance Criteria

- [ ] `abitat iphone` defaults to relay transport after local tests pass.
- [ ] The Mac prints a QR/manual payload with `transport: "relay"`, `endpoint`, `relayId`, `macId`, `pairingSecret`, and short expiry.
- [ ] iPhone pairs through the relay while not on the Mac's network.
- [ ] The Mac locally consumes pairing and mints the device token.
- [ ] The relay never stores or creates a usable mobile control token.
- [ ] The iPhone can list projects, read messages, and send/start/continue conversations through relay mode.
- [ ] Unpaired phones and invalid tokens are rejected by the Mac.
- [ ] A phone connected to one relay room cannot control another relay room's Mac.
- [ ] If the Mac is offline, the iPhone receives a clear offline/unreachable error.
- [ ] No hosted database is required for core mobile control.
- [ ] Temporary tunnel and manual modes remain available as fallbacks.
- [ ] Docs and install/onboarding instructions describe the relay security model.

## Files And Responsibilities

- Create `apps/relay/`: Cloudflare Worker package with Durable Object relay rooms and tests.
- Create `packages/shared/src/relay.ts`: transport-independent relay protocol types and crypto helpers.
- Modify `packages/shared/src/index.ts`: export relay protocol.
- Modify `apps/host-daemon/src/local-control/state.ts`: support `relay` transport and relay pairing metadata.
- Modify `apps/host-daemon/src/local-control/transport.ts`: resolve relay transport settings.
- Create `apps/host-daemon/src/local-control/relay-client.ts`: Mac outbound WebSocket relay client and local request bridge.
- Modify `apps/host-daemon/src/cli/index.ts`: start relay client, emit relay payloads, and default to relay.
- Modify host-daemon tests: relay state, transport, relay client, and CLI behavior.
- Modify `apps/cli/src/iphone.ts`, `apps/cli/src/index.ts`, and CLI tests: include relay transport default.
- Modify `apps/ios/src/types.ts`, `apps/ios/src/api/client.ts`, pairing screens/store tests: parse relay payloads and send relay-wrapped API calls.
- Modify docs, Homebrew validation, and public install smoke tests for relay mode.

## Task 1: Shared Relay Protocol

- [ ] Write failing tests for relay envelope encryption/decryption, wrong secret rejection, tamper rejection, stale timestamp rejection, and replay id rejection.
- [ ] Add `packages/shared/src/relay.ts` with protocol types and crypto helpers.
- [ ] Export the relay helpers from `packages/shared/src/index.ts`.
- [ ] Run shared package build/typecheck and targeted tests.

## Task 2: Cloudflare Relay Worker

- [ ] Create `apps/relay` package with `package.json`, `tsconfig.json`, `wrangler.jsonc`, and Vitest config.
- [ ] Implement Worker routes:
  - `GET /relay/health`
  - `GET /relay/:relayId/status`
  - `GET /relay/:relayId/host` for Mac WebSocket upgrade
  - `POST /relay/:relayId/request` for iPhone request envelopes
- [ ] Implement a Durable Object relay room per `relayId`.
- [ ] Ensure relay rooms forward opaque envelopes only and do not parse product tokens.
- [ ] Add tests for host connect, request forwarding, offline Mac, timeout, and cross-room isolation.
- [ ] Add root/package scripts as needed so `pnpm --filter @abitat_reece/relay test` and `typecheck` work.

## Task 3: Host Relay Client

- [ ] Add relay transport type and pairing payload fields to host local-control state.
- [ ] Add relay transport resolution with configurable endpoint:
  - default `https://workspace.abitat.io`
  - env override `ABITAT_RELAY_ENDPOINT`
  - CLI override `--relay-endpoint`
- [ ] Implement `relay-client.ts` to open the Mac outbound WebSocket, receive encrypted requests, call the local API internally, and return encrypted responses.
- [ ] Add reconnection with clear status logs.
- [ ] Add tests for successful relay requests, invalid secrets/tokens, offline/reconnect behavior, and room isolation.

## Task 4: CLI Relay Default

- [ ] Update `abitat iphone` default transport to `relay`.
- [ ] Preserve explicit `--transport temporary-tunnel`, `--transport quick-tunnel`, `--transport local`, `--transport tailscale`, and `--transport manual`.
- [ ] Update CLI tests to expect relay by default.
- [ ] Verify package resolution still launches the packaged host daemon.

## Task 5: iPhone Relay Mode

- [ ] Extend iOS pairing payload parsing to accept `transport: "relay"` and `relayId`.
- [ ] Store relay metadata with the paired Mac token.
- [ ] Route pairing and authenticated API calls through the relay endpoint when paired transport is relay.
- [ ] Keep direct HTTP behavior for local/tailscale/manual/temporary tunnel modes.
- [ ] Add iOS tests for parsing, pairing, stored reconnect metadata, project listing through relay, offline Mac errors, and invalid token rejection.

## Task 6: Docs, Packaging, And Deployment

- [ ] Update docs to make relay the production default and temporary tunnels fallback/demo mode.
- [ ] Update Homebrew validation and smoke install checks.
- [ ] Add Cloudflare deployment instructions for `apps/relay`.
- [ ] If credentials are available, run `wrangler whoami`, deploy relay to Cloudflare, and verify `GET /relay/health`.
- [ ] If credentials are unavailable, leave exact deploy command and local verification evidence.

## Required Verification

- [ ] `pnpm --filter @abitat_reece/relay test`
- [ ] `pnpm --filter @abitat_reece/relay typecheck`
- [ ] `pnpm --filter @abitat_reece/shared build`
- [ ] `pnpm --filter @abitat_reece/shared typecheck`
- [ ] `pnpm --filter @abitat_reece/host-daemon test`
- [ ] `pnpm --filter @abitat_reece/host-daemon typecheck`
- [ ] `pnpm --filter @abitat_reece/cli test`
- [ ] `pnpm --filter @abitat_reece/cli typecheck`
- [ ] `pnpm --filter abitat-ios test`
- [ ] `pnpm --filter abitat-ios typecheck`
- [ ] `pnpm --filter web test`
- [ ] `pnpm --filter web lint`
- [ ] `pnpm --filter web typecheck`
- [ ] `pnpm test:homebrew`
- [ ] `pnpm smoke:public-install`
- [ ] `pnpm exec prettier --check --ignore-unknown <changed files>`
- [ ] `git diff --check`

## Manual Smoke Test

- [ ] Start relay locally or against deployed Cloudflare.
- [ ] Run `abitat iphone --transport relay`.
- [ ] Confirm pairing payload includes relay endpoint and relay id.
- [ ] Confirm relay health responds.
- [ ] Confirm unauthenticated/invalid request is rejected.
- [ ] Pair through relay.
- [ ] Confirm authenticated project/status API works.
- [ ] Start or continue a conversation through relay.
- [ ] Stop Mac host and confirm the phone/client gets Mac offline.
- [ ] Restart Mac host and confirm reconnect.
