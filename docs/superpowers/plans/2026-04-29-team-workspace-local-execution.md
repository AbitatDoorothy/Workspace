# Team Workspace With Local-Only Codex Execution Plan

> **For agentic workers:** This is an implementation handoff plan. Treat it as the source of truth unless the user gives a newer instruction. Work task-by-task, keep changes surgical, and update tests with each behavior change. Do not collapse this into a generic multi-user app; the core requirement is shared web state with private local execution per user/machine.

**Goal:** Convert Abitat Workspace from a single active host/tunnel workflow into a team workspace where multiple users share the same web UI/database, can see each other's projects and conversation cards, but each user's Codex CLI sessions run only on that user's own local machine. This must work across macOS and Windows.

**Primary user story:** Reece and a developer join the same workspace. Both can open the same `workspace.abitat.io` web UI and see all project conversations. If Reece starts a Codex conversation, iTerm2/Terminal opens on Reece's Mac only. The developer can see the card/status/summary but cannot open or continue Reece's local Codex thread. If the developer starts a conversation, the local terminal opens on the developer's machine only, whether that machine is macOS or Windows.

**Architecture decision:** Make `workspace.abitat.io` a shared cloud control plane, not a tunnel into one person's laptop. Local machines become paired execution workers. The cloud backend stores shared product state; local daemons poll only for jobs assigned to their own machine.

---

## 1. Non-Negotiable Requirements

- The web UI state must be shared across team members.
- All users in the same workspace can see conversations created by other users.
- Conversation execution must be local to the creator's machine.
- A user must not be able to open or continue another user's Codex CLI thread.
- A conversation must remember the machine that created it.
- Continuing a conversation must route back to the same machine that owns its Codex session.
- Summary generation must route back to the same machine that owns its Codex session.
- Multi-machine support must work with at least:
  - macOS host daemon using iTerm2 or Terminal.app.
  - Windows host daemon using Windows Terminal or PowerShell.
- The system must handle machines being offline.
- Existing single-user local development should continue to work.
- Existing project/conversation data should migrate safely.

## 2. Current State To Preserve

Before editing, inspect the current implementation in these areas:

- Shared schemas: `packages/shared/src/index.ts`
- Prisma schema: `apps/web/prisma/schema.prisma`
- Conversation queue/service: `apps/web/server/conversations/conversation-queue-service.ts`
- Conversation repository mapping: `apps/web/server/conversations/index.ts`
- Host/machine services:
  - `apps/web/server/hosts/index.ts`
  - `apps/web/server/hosts/host-service.ts`
  - `apps/web/app/api/hosts/*`
- Daemon polling and runtime:
  - `apps/host-daemon/src/cli/index.ts`
  - `apps/host-daemon/src/cli/daemon-connection.ts`
  - `apps/host-daemon/src/runtime/cli.ts`
  - `apps/host-daemon/src/transport/api-client.ts`
- Project UI:
  - `apps/web/app/projects/[projectId]/page.tsx`
  - `apps/web/app/projects/[projectId]/conversation-board.tsx`
  - `apps/web/app/projects/[projectId]/start-codex-dialog.ts`
- Existing tests:
  - `apps/web/tests/conversation-service.test.ts`
  - `apps/web/tests/conversation-board-model.test.ts`
  - `apps/web/tests/start-codex-dialog.test.tsx`
  - `apps/host-daemon/tests/cli-runtime.test.ts`
  - `apps/host-daemon/tests/conversation-runtime.test.ts`
  - `packages/shared/tests/schemas.test.ts`

Preserve the existing behavior where a conversation can start Codex in a visible local terminal and later resume the same Codex thread by session id.

## 3. Target Architecture

```text
workspace.abitat.io
  hosted Next.js app
  hosted/shared PostgreSQL
  shared auth/session
  workspace/project/conversation UI
  daemon job queue

Reece's Mac
  host daemon paired as machine_reerce_mac
  local Codex CLI
  iTerm2 or Terminal.app
  local project folder/worktrees
  polls only jobs assigned to machine_reece_mac

Developer's Windows PC
  host daemon paired as machine_dev_windows
  local Codex CLI
  Windows Terminal or PowerShell
  local project folder/worktrees
  polls only jobs assigned to machine_dev_windows
```

Important distinction:

- Shared data lives in the cloud backend.
- Runtime execution, terminal windows, local files, and Codex session storage stay on the owner machine.

## 4. Roles And Permissions

Implement the first version with simple rules:

- Workspace `owner` and `member` can see all workspace projects and conversation cards.
- A conversation has exactly one `ownerUserId`.
- A conversation has exactly one execution owner machine, `hostMachineId`, once started.
- Only `conversation.ownerUserId` can:
  - start their own conversation,
  - open/continue their own Codex CLI,
  - move their own conversation to complete,
  - trigger summary generation for their own conversation,
  - delete their own conversation.
- Other workspace members can:
  - view the card,
  - view status,
  - view summary if complete,
  - see owner/machine/offline state.
- Other workspace members cannot:
  - open CLI,
  - continue the thread,
  - resume the runtime session,
  - complete the card if doing so would trigger local summary execution,
  - delete the card.

Later, admin override can be added, but do not implement it in this pass unless explicitly requested.

## 5. Data Model Changes

Add or confirm these fields.

### Machine

Existing `Machine` should become a real per-device identity, not just `machine_demo`.

Required fields:

- `id`
- `workspaceId`
- `userId` or `ownerUserId`: the user who owns this machine.
- `name`: display name such as `Reece MacBook Pro` or `Dev Windows Desktop`.
- `type`: keep `host` / `client` if already present; local execution machines can use `host`.
- `platform`: `darwin`, `win32`, `linux`.
- `arch`: optional, e.g. `arm64`, `x64`.
- `status`: `pending`, `online`, `offline`, `error`.
- `lastSeenAt`.
- `installedToolsJson`.
- `hostTokenHash` or equivalent secure token representation.
- `createdAt`, `updatedAt`.

If the schema already has a machine token model, extend that rather than creating duplicate concepts.

### Conversation

Add:

- `ownerUserId`: required user who owns and may operate this conversation.
- `hostMachineId`: nullable initially, set when the conversation is created or when the start job is assigned.
- `runtimeSessionId`: already exists; keep it tied to `hostMachineId`.

Rules:

- For new conversations, set `ownerUserId = currentUser.id`.
- For new Codex conversations, set `hostMachineId` to the selected online machine for the user.
- Do not allow `runtimeSessionId` to be used on a different machine.

### DaemonJob

Add:

- `targetMachineId`: machine that may poll and execute this job.
- `targetUserId`: optional denormalized owner for easier debugging and filtering.

Rules:

- Every runtime job must have `targetMachineId`.
- `start_conversation`, `summarize_conversation`, `commit_and_push`, and future runtime jobs must be assigned to the conversation's `hostMachineId`.
- Polling must never return jobs for a different machine.

### Backfill Strategy

For existing local/demo data:

- Create a migration that adds nullable fields first if needed.
- Backfill conversations:
  - `ownerUserId = createdByUserId`.
  - `hostMachineId = machine_demo` where the existing local demo machine exists and conversation has runtime metadata.
- Backfill daemon jobs:
  - `targetMachineId = machineId` if already assigned.
  - otherwise use the conversation's `hostMachineId` when available.
- After backfill, decide whether new rows require non-null constraints. If production data may be inconsistent, keep nullable but enforce required values in services.

## 6. Authentication And User Identity

Current local password auth may be enough for development, but team mode needs stable users.

Minimum implementation:

- Keep existing password/session auth if that is the current project style.
- Ensure every request can resolve a real `currentUser.id`.
- Stop relying on hardcoded `user_demo` in production paths.
- Keep `user_demo` only for local seed/demo.

Required service-level behavior:

- `createConversation` must receive or derive `currentUser.id`.
- `continueConversation` must verify `currentUser.id === conversation.ownerUserId`.
- `setConversationLabel` must verify ownership before allowing `complete`, because completion triggers owner-local summary.
- `deleteConversation` must verify ownership.
- API routes should reject unauthorized actions with `403`, not generic `400`.

Testing requirement:

- Add tests where a non-owner can list conversations but cannot continue/delete/complete another user's conversation.

## 7. Machine Pairing Model

Implement per-user machine pairing.

### Desired Flow

1. User logs into `workspace.abitat.io`.
2. User opens a "Pair this machine" screen or command setup.
3. Web app creates a pairing code scoped to:
   - workspace id,
   - user id,
   - expiration timestamp.
4. User runs a host daemon command on their local machine:

```bash
pnpm cloud:host --pair ABITAT-XXXXXX
```

or a packaged daemon equivalent.

5. Daemon sends:
   - pairing code,
   - machine display name,
   - platform,
   - arch,
   - daemon version.
6. Server creates or updates a `Machine` row owned by that user.
7. Server returns:
   - `machineId`,
   - `workspaceId`,
   - host token.
8. Daemon stores this locally.

### Local Config Files

Support current config path on macOS and add Windows-safe config:

- macOS/Linux: `~/.abitat-host/config.json`
- Windows: `%USERPROFILE%\.abitat-host\config.json`

Use `os.homedir()` and `path.join()` everywhere. Do not concatenate paths with `/`.

Config should include:

```json
{
  "apiUrl": "https://workspace.abitat.io",
  "workspaceId": "workspace_...",
  "machineId": "machine_...",
  "hostToken": "secret",
  "userId": "user_..."
}
```

Do not store another user's token on a machine.

## 8. Daemon Polling And Job Routing

Change daemon polling from "any active machine asks for next job" to "this specific machine asks for its jobs."

### Poll Request

Request should include:

```json
{
  "machineId": "machine_reece_mac",
  "activeConversationIds": ["conversation_..."]
}
```

Server must authenticate the host token and verify:

- token belongs to `machineId`,
- machine is online,
- machine is in the workspace,
- token is not expired/revoked.

### Poll Response

Server should only return:

```text
job.targetMachineId === request.machineId
```

Never return a job for a different user's machine.

### Active Job Recovery

Current stale job recovery should become per-machine:

- A job is stale if assigned to this machine, marked running/preparing, and the machine no longer reports it active after the stale timeout.
- Do not mark another machine's job stale from this machine's heartbeat.
- If a machine goes offline, show cards as waiting/offline instead of immediately failing user work. Fail only after a configured timeout or explicit cancel.

## 9. Conversation Creation Flow

On the project page, `Start Codex` should use the current logged-in user.

### UI Behavior

When user clicks `Start Codex`:

1. Open dialog.
2. Ask for:
   - task title,
   - task type: `feature`, `bugfix`, `investigation`, `refactor`.
3. Determine the user's eligible local machines:
   - machines where `ownerUserId === currentUser.id`,
   - `status === online`,
   - tool scan includes Codex installed.
4. If one eligible machine exists, use it automatically.
5. If multiple eligible machines exist, show a machine selector.
6. If no eligible machine exists, show a clear disabled state:

```text
No online Codex host is paired for your account. Pair this machine to start Codex locally.
```

### API Behavior

`POST /api/conversations` should:

- derive `ownerUserId` from session,
- validate project membership,
- validate selected `hostMachineId` belongs to current user,
- validate selected machine is in same workspace,
- validate selected machine is online and has Codex if enforcing capabilities at creation,
- create conversation,
- create daemon job with `targetMachineId = hostMachineId`.

Do not let the client pass arbitrary `ownerUserId`.

## 10. Continue/Open CLI Flow

When rendering cards:

- Everyone sees the card.
- Owner sees active `Open CLI` if:
  - `conversation.ownerUserId === currentUser.id`,
  - `conversation.hostMachineId` exists,
  - `conversation.runtimeSessionId` exists,
  - owner machine is online or resumable job can be queued.
- Non-owner sees disabled or hidden button.

Recommended UI:

```text
Open CLI              enabled for owner
Owned by Reece        read-only indicator for non-owner
Owner machine offline disabled state when owner machine offline
```

`POST /api/conversations/:id/continue` should:

- require current user is owner,
- require runtime session id,
- require host machine id,
- create `start_conversation` job assigned to `conversation.hostMachineId`,
- keep `resumeSessionId = conversation.runtimeSessionId`,
- not allow changing the target machine.

## 11. Complete And Summary Flow

When owner drags their card to Complete:

1. Web updates the conversation label/status.
2. Server creates a `summarize_conversation` job.
3. Job is assigned to `conversation.hostMachineId`.
4. Owner's daemon resumes the same Codex session in hidden/inline mode.
5. Daemon sends summary event.
6. Web summary page shows result.

Rules:

- Non-owner cannot move another person's card to Complete in the first version.
- If owner machine is offline, mark conversation as `summary_queued` or keep `awaiting_approval`/`running` with a visible "waiting for owner machine" message.
- Do not attempt to run summary on another user's machine.

If the current status enum does not support `summary_queued`, either:

- add it intentionally with tests and migration, or
- reuse `queued` plus an event/message.

Do not overload `failed` for "owner machine offline."

## 12. Cross-OS Host Runtime Requirements

The host daemon must avoid macOS-only assumptions outside platform-specific modules.

### Platform Detection

Use Node:

```ts
process.platform
```

Expected values:

- `darwin`: macOS
- `win32`: Windows
- `linux`: Linux/WSL

Add a small runtime abstraction:

```text
TerminalLauncher
  launch(command, args, cwd, env, logPath, promptPath)
  supportsVisibleTerminal()
  platformName
```

Implement:

- macOS launcher:
  - prefer iTerm2 when available,
  - fallback to Terminal.app,
  - use AppleScript only in macOS module.
- Windows launcher:
  - prefer Windows Terminal `wt.exe`,
  - fallback to PowerShell,
  - support visible terminal windows,
  - use `.ps1` or direct PowerShell command files.
- Linux/WSL launcher:
  - for now use inline/headless by default, or support common terminals later.

### macOS Terminal Behavior

Current behavior can remain:

- create temp run directory,
- create command script,
- open iTerm2 tab/window,
- run Codex,
- capture log,
- parse exit marker,
- parse Codex session id.

Ensure macOS launcher stays isolated from Windows code.

### Windows Terminal Behavior

For Windows, implement a separate launcher.

Recommended approach:

1. Create temp run directory using `os.tmpdir()`.
2. Write:
   - `prompt.txt`,
   - `runtime.log`,
   - `codex-run.ps1`.
3. Launch Windows Terminal:

```powershell
wt.exe powershell.exe -NoExit -ExecutionPolicy Bypass -File "C:\path\to\codex-run.ps1"
```

4. If `wt.exe` is unavailable, fallback:

```powershell
powershell.exe -NoExit -ExecutionPolicy Bypass -File "C:\path\to\codex-run.ps1"
```

5. Script should:
   - `Set-Location` to worktree path,
   - write shell/process marker to `runtime.log`,
   - print a visible header,
   - run Codex with the right args,
   - tee output to runtime log,
   - write exit marker,
   - keep the window open or exit depending on config.

PowerShell log capture pattern:

```powershell
& codex @args 2>&1 | Tee-Object -FilePath $LogPath -Append
$status = $LASTEXITCODE
Add-Content -Path $LogPath -Value "__ABITAT_EXIT_<id>__:$status"
```

Be careful with quoting. Use argument arrays where possible instead of building one giant string.

### Windows Path Rules

- Use `path.join`, `path.resolve`, and `fileURLToPath` where needed.
- Do not assume `/tmp`.
- Do not assume chmod works.
- Do not assume shell scripts are executable.
- Do not use `script -q` on Windows.
- Do not assume `which`; use platform-aware command lookup:
  - macOS/Linux: `which codex`
  - Windows: `where.exe codex`

### Codex Session Storage

Current Codex session detection may scan `~/.codex/sessions`.

Make this path cross-OS:

- Use `process.env.CODEX_HOME` if set.
- Else use `path.join(os.homedir(), ".codex")`.
- Use recursive file walking with `path.join`, not string separators.

Do not assume session files use POSIX paths. Match session metadata by normalized cwd.

### Process Liveness

macOS/Linux may use `process.kill(pid, 0)`.

Windows caveat:

- `process.kill(pid, 0)` may work for Node-owned processes, but can be inconsistent for shell/window trees.
- Prefer marker/exit-file based completion for terminal-launched jobs.
- For Windows, consider polling the log exit marker and using a startup timeout.
- If using process checks, isolate implementation in a platform-specific helper and test it with mocked `isProcessAlive`.

## 13. Shared Cloud Deployment

For team mode, avoid using `pnpm cloud` as the production shared path because that tunnels to one Mac.

Recommended split:

### Cloud Web

Deploy:

- Next.js web app
- shared Postgres
- stable `workspace.abitat.io`

Environment:

```text
DATABASE_URL=<hosted postgres>
ABITAT_PUBLIC_URL=https://workspace.abitat.io
ABITAT_SESSION_SECRET=<strong secret>
ABITAT_LOGIN_PASSWORD=<dev-only fallback, remove later>
```

### Local Host Daemon

Each developer runs:

```bash
pnpm cloud:host
```

or eventually:

```bash
abitat-host start
```

Environment/config:

```text
ABITAT_API_URL=https://workspace.abitat.io
ABITAT_CLI_RUNTIME_MODE=terminal
```

The local host daemon must not start its own web server in team mode.

### Local Development Mode

Keep `pnpm cloud` for local single-machine testing if useful.

But document:

- `pnpm cloud` means "this Mac is the web server and host."
- team mode means "hosted web server plus local host daemons."

## 14. API Changes

Update shared schemas in `packages/shared/src/index.ts`.

### Machine Pairing

Add fields to host pairing request:

```ts
{
  pairingCode: string;
  machineName: string;
  daemonVersion: string;
  platform: "darwin" | "win32" | "linux" | string;
  arch?: string;
}
```

Response should include:

```ts
{
  machineId: string;
  workspaceId: string;
  userId: string;
  hostToken: string;
}
```

### Job Poll

Request:

```ts
{
  machineId: string;
  activeConversationIds?: string[];
}
```

Server should derive machine authorization from token.

### Daemon Job Payload

Ensure all runtime jobs include enough machine-specific metadata:

- `hostLocalPath`
- `worktreePath`
- `branchName`
- `resumeSessionId`
- `presentation`

But routing should be outside payload:

- `targetMachineId`
- `targetUserId`

Do not let daemon choose target user or machine.

## 15. UI Changes

### Project Page

Conversation cards should show:

- title
- type
- label/status
- owner display name
- owner machine name
- owner machine online/offline indicator

Actions:

- Owner:
  - `Open CLI` enabled when metadata exists.
  - `Delete` enabled.
  - drag to Complete enabled.
- Non-owner:
  - no active `Open CLI`,
  - no active `Delete`,
  - no drag-to-complete,
  - can open summary when complete.

### Start Codex Dialog

Add machine selection only if needed.

Fields:

- title
- task type
- local machine selector if current user has multiple online Codex machines

Error states:

- no paired machine
- paired machine offline
- Codex missing on paired machine
- backend cannot assign job

### Workspace/Settings Page

If not already present, add a minimal "My Machines" page or section:

- list current user's machines,
- show online/offline,
- show platform,
- show last seen,
- show installed tools,
- show pair command/code.

This can be minimal but is important for debugging team mode.

## 16. Security Rules

Implement checks server-side. UI-only disable is not enough.

Required checks:

- Machine token can only heartbeat/poll for its own machine.
- User can only start jobs on a machine they own.
- User can only continue/delete/complete conversations they own.
- User can see other workspace conversations only if they are a workspace member.
- Host daemon cannot update arbitrary conversations; run event ingest must require valid machine token and should verify job/conversation assignment when feasible.
- Runtime session id should never allow cross-machine resume.

Avoid logging host tokens, pairing tokens, or raw secrets.

## 17. Migration Plan

Create one Prisma migration for team execution fields.

Suggested migration order:

1. Add nullable columns:
   - `Machine.ownerUserId`
   - `Machine.platform`
   - `Machine.arch`
   - `Conversation.ownerUserId`
   - `Conversation.hostMachineId`
   - `DaemonJob.targetMachineId`
   - `DaemonJob.targetUserId`
2. Backfill:
   - machines owned by workspace owner or `user_demo` for seed data,
   - conversations from `createdByUserId`,
   - conversation host machine from existing machine when obvious,
   - jobs from existing `machineId` or conversation host machine.
3. Add indexes:
   - `Machine(workspaceId, ownerUserId)`
   - `Machine(ownerUserId, status)`
   - `Conversation(ownerUserId)`
   - `Conversation(hostMachineId)`
   - `DaemonJob(targetMachineId, status)`
4. Add foreign keys where safe.
5. Update Prisma client.

Only make fields non-null if all creation paths set them and migration backfill is reliable.

## 18. Implementation Phases

### Phase 1: Model And Schema Foundation

- [ ] Update Prisma schema with ownership and target machine fields.
- [ ] Update shared Zod schemas.
- [ ] Add migration and seed updates.
- [ ] Update repository mapping functions.
- [ ] Add tests for schema parsing and repository read/write mapping.

Verification:

```bash
pnpm db:generate
pnpm --filter @abitat_reece/shared test
pnpm --filter web test -- conversation-service.test.ts
pnpm typecheck
```

### Phase 2: Machine Pairing And Identity

- [ ] Add per-user machine ownership to pairing.
- [ ] Store platform/arch from daemon pairing request.
- [ ] Update daemon config to include `userId`.
- [ ] Update host token validation to bind token to machine.
- [ ] Update heartbeat to preserve machine owner/platform.
- [ ] Add tests for pairing two users/two machines.

Verification:

```bash
pnpm --filter web test -- host-service.test.ts
pnpm --filter host-daemon test -- daemon-connection.test.ts
pnpm typecheck
```

### Phase 3: Job Routing

- [ ] Add `targetMachineId` to daemon job creation.
- [ ] Update poll query to return only jobs for polling machine.
- [ ] Update stale job recovery to be per-machine.
- [ ] Ensure start/continue/summary/commit jobs all route to conversation host machine.
- [ ] Add tests:
  - Reece machine does not receive developer job.
  - Developer machine does not receive Reece job.
  - Summary job routes to original owner machine.
  - Continue job routes to original owner machine.

Verification:

```bash
pnpm --filter web test -- conversation-service.test.ts
pnpm test
```

### Phase 4: Server-Side Permissions

- [ ] Enforce owner-only continue.
- [ ] Enforce owner-only delete.
- [ ] Enforce owner-only complete/summary trigger.
- [ ] Allow workspace members to list/read conversations.
- [ ] Return `403` for authorization failures.
- [ ] Add tests for owner and non-owner behavior.

Verification:

```bash
pnpm --filter web test -- conversation-service.test.ts role-checks.test.ts
pnpm typecheck
```

### Phase 5: UI Ownership And Machine State

- [ ] Render owner name on conversation cards.
- [ ] Render machine name/status on conversation cards.
- [ ] Disable/hide `Open CLI` for non-owner.
- [ ] Disable/hide delete for non-owner.
- [ ] Disable drag-to-complete for non-owner.
- [ ] Show offline machine messaging.
- [ ] Add/update UI model tests for action availability.

Verification:

```bash
pnpm --filter web test -- conversation-board-model.test.ts start-codex-dialog.test.tsx navigation.test.ts
pnpm --filter web lint
```

### Phase 6: Cross-OS Terminal Launcher

- [ ] Extract terminal launching behind a platform abstraction.
- [ ] Keep macOS iTerm2 behavior working.
- [ ] Add Windows launcher using `wt.exe` with PowerShell fallback.
- [ ] Add platform-aware command lookup.
- [ ] Add platform-safe temp/script/log handling.
- [ ] Add path normalization for Codex session scan.
- [ ] Add tests with mocked launchers for `darwin` and `win32`.

Verification:

```bash
pnpm --filter host-daemon test -- cli-runtime.test.ts conversation-runtime.test.ts tool-scanner.test.ts
pnpm --filter host-daemon typecheck
```

Manual verification:

- macOS: Start Codex opens iTerm2, creates a session id, can resume.
- Windows: Start Codex opens Windows Terminal or PowerShell, creates a session id, can resume.

### Phase 7: Hosted Team Mode

- [ ] Document hosted web deployment separately from local daemon.
- [ ] Ensure `pnpm cloud:host` can connect to `https://workspace.abitat.io`.
- [ ] Ensure local daemon does not assume localhost in team mode.
- [ ] Add runbook for pairing Mac and Windows machines.
- [ ] Add health/status UI or logs to debug daemon connection.

Verification:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check
```

Manual end-to-end:

1. User A on macOS pairs a machine.
2. User B on Windows pairs a machine.
3. User A creates conversation in shared project.
4. User A sees local Mac terminal open.
5. User B sees User A's card but cannot open CLI.
6. User B creates conversation.
7. User B sees local Windows terminal open.
8. User A sees User B's card but cannot open CLI.
9. User A completes User A card; summary runs on User A machine.
10. User B completes User B card; summary runs on User B machine.

## 19. Test Matrix

### Unit Tests

- Schema accepts new machine/user/job fields.
- Schema rejects invalid target machine data.
- Conversation service assigns owner and machine correctly.
- Conversation service rejects non-owner continue/delete/complete.
- Polling returns only jobs for the requesting machine.
- Stale recovery only touches jobs assigned to the requesting machine.
- Board model computes owner/non-owner actions correctly.
- Windows launcher builds safe PowerShell command/script.
- macOS launcher still builds iTerm2 AppleScript.

### Integration Tests

Create in-memory or test-db flows:

- two users in same workspace,
- two machines in same workspace,
- one project,
- each user creates one Codex conversation,
- each daemon polls,
- each daemon only receives its own job,
- each conversation stores distinct host machine id.

### Manual Cross-OS Tests

macOS:

- Pair machine.
- Start Codex.
- Verify iTerm2 opens.
- Exit Codex.
- Verify session id captured.
- Continue same thread.
- Complete and summary.

Windows:

- Pair machine.
- Start Codex.
- Verify Windows Terminal or PowerShell opens.
- Exit Codex.
- Verify session id captured.
- Continue same thread.
- Complete and summary.

Mixed:

- Mac user cannot open Windows user's CLI.
- Windows user cannot open Mac user's CLI.
- Both users see same shared cards and summaries.

## 20. Acceptance Criteria

The implementation is complete only when all of these are true:

- A shared hosted `workspace.abitat.io` can be used by at least two users.
- Two users see the same project and conversation board.
- Each conversation shows owner and machine status.
- User A can start Codex only on User A's paired machine.
- User B can start Codex only on User B's paired machine.
- User A cannot open, continue, delete, or complete User B's conversation.
- User B cannot open, continue, delete, or complete User A's conversation.
- Daemon polling never returns another machine's job.
- Continuing a conversation resumes the original machine's Codex session.
- Completing a conversation runs summary on the original machine.
- macOS visible terminal flow works.
- Windows visible terminal flow works.
- Offline owner machine state is visible and does not route work to another machine.
- Automated tests cover ownership, routing, and cross-platform terminal command generation.
- Full verification passes:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
git diff --check
```

## 21. Common Failure Modes To Avoid

- Do not let the browser choose arbitrary `targetMachineId` without server validation.
- Do not route summary jobs to "any online daemon."
- Do not allow another user to resume a Codex session id created on someone else's machine.
- Do not rely on disabled UI buttons as permission enforcement.
- Do not hardcode `machine_demo` or `user_demo` outside seed/demo code.
- Do not use macOS AppleScript paths in Windows code.
- Do not use POSIX shell scripts for Windows terminal launch.
- Do not mark owner-machine-offline as a permanent job failure immediately.
- Do not make hosted team mode depend on a tunnel into one developer's laptop.
- Do not store raw host tokens in logs or events.

## 22. Suggested Commit Strategy

Use small commits if possible:

1. `feat: add machine ownership schema`
2. `feat: route daemon jobs by target machine`
3. `fix: enforce conversation owner actions`
4. `feat: show conversation owner and machine status`
5. `feat: add cross-platform terminal launchers`
6. `docs: add team workspace setup runbook`

If the agent implements everything in one branch, still keep tests green after each phase.

## 23. Final Notes For The Implementing Agent

This feature is mostly about boundaries:

- shared cloud state,
- private local execution,
- strict owner permissions,
- deterministic job routing.

When uncertain, prefer denying an action over accidentally letting one developer run or resume another developer's local Codex session. Keep terminal/runtime code platform-specific behind small interfaces, and keep the conversation service as the source of truth for ownership and routing decisions.
