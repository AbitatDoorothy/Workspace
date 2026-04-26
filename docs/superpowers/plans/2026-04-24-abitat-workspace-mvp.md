# Abitat Workspace MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working MVP of Abitat Workspace: a web-controlled shared local coding-agent runtime where a host Mac can run Codex/Claude-style agents against GitHub repos through isolated branches/worktrees, while users manage projects, agents, conversations, logs, diffs, and approval from a browser.

**Architecture:** Use a web app plus backend API for product state, authentication, and realtime UI, paired with a host runtime daemon running on the host MacBook. The backend stores workspaces, projects, agents, conversations, run events, and approval state; the daemon performs local runtime actions such as CLI detection, repo clone/sync, worktree creation, agent process execution, git diff collection, commit, push, and optional PR creation.

**Tech Stack:** Recommended MVP stack is TypeScript end-to-end: Next.js for the web app and API, Prisma + PostgreSQL for data, WebSocket or SSE for realtime run events, a Node.js host daemon for local machine integration, GitHub App/OAuth integration for repository access, and optional Telegram Bot API deferred until after the core web/GitHub loop works.

---

## 1. Product Definition

Abitat Workspace is a team-shared local coding-agent runtime. A host machine, usually a MacBook, owns the actual runtime environment: local repositories, installed CLIs, API credentials, git tools, and agent execution. Other users enter the workspace through a browser, create or use project-level agents, start development conversations, review logs and diffs, and approve git operations.

This is not an online IDE. It is a controlled remote interface to a real local development machine.

The MVP should prove one critical loop:

1. A host registers a workspace and connects a host daemon.
2. The daemon scans the host for installed tools such as `git`, `gh`, `codex`, `claude`, `node`, and `python`.
3. A user creates a project and connects one GitHub repository.
4. A user creates one project-level agent with name, role, instructions, model, runtime, and allowed tools.
5. A user starts a conversation for a feature or bugfix task.
6. The daemon creates an isolated branch/worktree for that conversation.
7. The daemon runs the selected coding-agent runtime against the repo.
8. The web app streams run logs and status updates.
9. When the run finishes, the user reviews summary, changed files, diff, and test results.
10. The user approves commit and push.
11. The system commits, pushes the branch, and optionally opens a GitHub PR.

The MVP succeeds when this loop works reliably for one host, one workspace, one repo per project, one agent per project, and browser-based approvals.

## 2. MVP Scope

### In Scope

- Workspace creation and host registration.
- Host daemon pairing with backend.
- Host daemon heartbeat and installed tool scan.
- Project creation with one GitHub repository URL.
- Repository clone/sync on the host machine.
- Agent creation with:
  - name
  - role
  - instructions
  - model
  - runtime
  - allowed tools
- Conversation creation with:
  - task type: `feature`, `bugfix`, `investigation`, `refactor`
  - prompt
  - associated project and agent
- Isolated branch/worktree per conversation.
- Agent process launch from daemon.
- Realtime log streaming to the web app.
- Run event persistence.
- Run completion summary.
- Changed file and diff collection.
- Manual approval before commit/push.
- Commit and push to GitHub branch.
- Optional PR creation if GitHub CLI or API credentials are available.
- Basic audit trail for who started and approved each run.

### Out of Scope for MVP

- Multiple host machines per workspace.
- Multiple repos per project.
- Automatic local pull/sync on every client machine.
- Full Telegram bot control.
- Browser-based code editor.
- Direct shell access from browser.
- Autonomous merge to main.
- Complex billing, metering, or model cost controls.
- Fine-grained per-command policy engine.
- Enterprise SSO.
- Multi-agent orchestration.

### Deferred but Important

- Telegram remote control.
- Client-side sync daemon for non-host users.
- Owner/admin/member/viewer role depth.
- Advanced command approvals.
- Secrets scanning and sensitive file policy.
- Run cost tracking.
- Agent templates.
- Conversation replay and export.

## 3. Recommended Repository Structure

If starting from an empty repository, use a monorepo:

```text
abitat-workspace/
  apps/
    web/
      app/
      components/
      lib/
      server/
      prisma/
      tests/
      package.json
    host-daemon/
      src/
        cli/
        config/
        git/
        runtime/
        transport/
        tools/
        workers/
      tests/
      package.json
  packages/
    shared/
      src/
        schemas/
        types/
        events/
      package.json
  docs/
    architecture/
    runbooks/
    decisions/
  package.json
  pnpm-workspace.yaml
  turbo.json
  README.md
```

### Responsibilities

`apps/web`

- User-facing browser UI.
- Authentication.
- Workspace, project, agent, conversation management.
- API routes or server actions.
- Database access.
- Realtime run event fanout.
- Approval UI.
- Diff and summary UI.

`apps/host-daemon`

- Runs on the host MacBook.
- Pairs with backend using a host token.
- Scans installed CLIs.
- Owns local repo storage.
- Creates branches/worktrees.
- Starts agent processes.
- Streams stdout/stderr/status back to backend.
- Collects diff/test results.
- Executes approved git commit/push/PR operations.

`packages/shared`

- Shared TypeScript types.
- Zod schemas for API payloads.
- Run event definitions.
- Status enums.
- Validation helpers.

## 4. Core Domain Model

Use these entities as the stable vocabulary across backend, daemon, and UI.

### Workspace

Represents a team/shared runtime space.

Fields:

- `id`
- `name`
- `ownerUserId`
- `createdAt`
- `updatedAt`

### User

Represents a person using the browser app.

Fields:

- `id`
- `email`
- `displayName`
- `createdAt`
- `updatedAt`

### WorkspaceMember

Connects users to workspaces.

Fields:

- `workspaceId`
- `userId`
- `role`: `owner`, `admin`, `member`, `viewer`
- `createdAt`

For MVP, implement `owner` and `member`; design the schema to allow the other roles later.

### Machine

Represents a host or client machine. MVP only needs host machines.

Fields:

- `id`
- `workspaceId`
- `name`
- `type`: `host`, `client`
- `status`: `pending`, `online`, `offline`, `error`
- `pairingTokenHash`
- `lastSeenAt`
- `installedToolsJson`
- `createdAt`
- `updatedAt`

### Project

Represents a coding project bound to one GitHub repo.

Fields:

- `id`
- `workspaceId`
- `name`
- `repoUrl`
- `defaultBranch`
- `hostLocalPath`
- `githubOwner`
- `githubRepo`
- `createdByUserId`
- `createdAt`
- `updatedAt`

### Agent

Represents a reusable project-level coding agent configuration.

Fields:

- `id`
- `projectId`
- `name`
- `role`
- `instructions`
- `model`
- `runtime`: `codex`, `claude`, `mock`
- `allowedToolsJson`
- `createdByUserId`
- `createdAt`
- `updatedAt`

Include `mock` runtime for development and tests. This is important because a new coding agent can build and verify the product without requiring Codex/Claude CLI credentials.

### Conversation

Represents one task execution.

Fields:

- `id`
- `agentId`
- `projectId`
- `workspaceId`
- `createdByUserId`
- `approvedByUserId`
- `type`: `feature`, `bugfix`, `investigation`, `refactor`
- `status`: `draft`, `queued`, `preparing`, `running`, `awaiting_approval`, `approved`, `committing`, `pushed`, `failed`, `cancelled`
- `prompt`
- `branchName`
- `worktreePath`
- `summary`
- `testsJson`
- `commitSha`
- `prUrl`
- `errorMessage`
- `createdAt`
- `updatedAt`

### RunEvent

Append-only stream of execution events.

Fields:

- `id`
- `conversationId`
- `sequence`
- `type`: `status`, `stdout`, `stderr`, `tool_scan`, `git`, `diff`, `test`, `summary`, `approval`, `error`
- `content`
- `metadataJson`
- `createdAt`

### ChangeSet

Snapshot of changed files and diff after the agent run.

Fields:

- `id`
- `conversationId`
- `filesChangedJson`
- `diffText`
- `createdAt`
- `updatedAt`

## 5. System Architecture

### Web App

The web app is the product control plane.

Core screens:

1. Workspace dashboard.
2. Host setup/pairing screen.
3. Project list and project detail.
4. Agent configuration page.
5. Conversation creation page.
6. Conversation run page with realtime logs.
7. Diff review and approval page.

The UI should be operational and dense rather than marketing-like. This is a workflow tool. Prioritize status visibility, clear approvals, logs, changed files, and obvious next actions.

### Backend API

The backend should expose APIs for:

- User/workspace bootstrap.
- Host daemon pairing.
- Host heartbeat.
- Tool scan upload.
- Project creation.
- Repo clone request.
- Agent creation.
- Conversation creation.
- Conversation event ingestion from daemon.
- Conversation event subscription from browser.
- Approval submission.
- Commit/push request after approval.

### Host Daemon

The daemon should be a long-running CLI process:

```bash
abitat-host start --config ~/.abitat-host/config.json
```

MVP behavior:

1. Load host config.
2. Connect to backend using host token.
3. Send heartbeat every 10-30 seconds.
4. Upload installed tool scan.
5. Poll or subscribe for daemon jobs.
6. Execute jobs one at a time.
7. Stream run events back to backend.

### Daemon Job Types

- `scan_tools`
- `clone_repo`
- `start_conversation`
- `collect_changeset`
- `commit_and_push`
- `create_pr`
- `cancel_conversation`

For MVP, polling is acceptable and simpler than persistent bidirectional networking. Use a short polling interval such as 2 seconds while a host is online.

### Realtime Strategy

Prefer Server-Sent Events for MVP because run events are mostly server-to-browser:

- Browser subscribes to `/api/conversations/:id/events/stream`.
- Backend sends persisted and new `RunEvent` records.
- If SSE is awkward in the chosen framework, use WebSocket.

## 6. Security Model

MVP must be safe enough for local use.

Hard constraints:

1. The browser must never expose arbitrary shell access.
2. The daemon must only operate inside a configured workspace root, for example `~/AbitatWorkspace`.
3. Each project local path must live under the workspace root.
4. Each conversation must use its own branch/worktree.
5. Commit and push require explicit approval from the browser.
6. The daemon should reject destructive commands outside the project worktree.
7. Tokens must be stored outside source control.

Recommended daemon workspace layout:

```text
~/AbitatWorkspace/
  repos/
    github.com/
      owner/
        repo.git-working/
  worktrees/
    conversation-id-branch-name/
  logs/
```

Branch naming:

```text
abitat/{conversationType}/{conversationIdShort}-{slug}
```

Example:

```text
abitat/feature/abc123-add-login-form
```

## 7. API Contract Draft

Use shared schemas for every request and response.

### Host Pairing

`POST /api/hosts/pair`

Request:

```json
{
  "pairingCode": "ABITAT-123456",
  "machineName": "Reece MacBook Pro",
  "daemonVersion": "0.1.0"
}
```

Response:

```json
{
  "machineId": "machine_123",
  "workspaceId": "workspace_123",
  "hostToken": "secret_host_token"
}
```

### Host Heartbeat

`POST /api/hosts/heartbeat`

Request:

```json
{
  "machineId": "machine_123",
  "status": "online",
  "activeConversationId": "conv_123"
}
```

Response:

```json
{
  "ok": true,
  "serverTime": "2026-04-24T00:00:00.000Z"
}
```

### Tool Scan Upload

`POST /api/hosts/tools`

Request:

```json
{
  "machineId": "machine_123",
  "tools": [
    { "name": "git", "installed": true, "version": "2.45.0", "path": "/usr/bin/git" },
    { "name": "gh", "installed": true, "version": "2.49.0", "path": "/opt/homebrew/bin/gh" },
    { "name": "codex", "installed": false },
    { "name": "claude", "installed": true, "version": "1.0.0", "path": "/usr/local/bin/claude" }
  ]
}
```

Response:

```json
{ "ok": true }
```

### Create Conversation

`POST /api/conversations`

Request:

```json
{
  "workspaceId": "workspace_123",
  "projectId": "project_123",
  "agentId": "agent_123",
  "type": "feature",
  "prompt": "Add password reset to the login page."
}
```

Response:

```json
{
  "conversationId": "conv_123",
  "status": "queued"
}
```

### Daemon Job Poll

`POST /api/daemon/jobs/poll`

Request:

```json
{
  "machineId": "machine_123"
}
```

Response:

```json
{
  "job": {
    "id": "job_123",
    "type": "start_conversation",
    "conversationId": "conv_123",
    "payload": {
      "repoUrl": "https://github.com/example/app.git",
      "defaultBranch": "main",
      "agentRuntime": "mock",
      "model": "mock-model",
      "instructions": "You are a careful coding agent.",
      "prompt": "Add password reset to the login page."
    }
  }
}
```

If no job exists:

```json
{ "job": null }
```

### Run Event Ingest

`POST /api/conversations/:id/events`

Request:

```json
{
  "sequence": 12,
  "type": "stdout",
  "content": "Running tests...",
  "metadata": {}
}
```

Response:

```json
{ "ok": true }
```

### Approval

`POST /api/conversations/:id/approve`

Request:

```json
{
  "approvalType": "commit_and_push",
  "commitMessage": "feat: add password reset flow"
}
```

Response:

```json
{
  "ok": true,
  "status": "approved"
}
```

## 8. Runtime Execution Strategy

### Mock Runtime First

Build a `mock` runtime before integrating real Codex/Claude CLIs.

The mock runtime should:

1. Receive project path, prompt, and instructions.
2. Append or modify a predictable file such as `ABITAT_RUN_LOG.md`.
3. Emit stdout events.
4. Exit successfully.

This lets the full product loop be tested without external agent credentials.

### Real Runtime Adapter Interface

All runtimes should implement:

```ts
export interface RuntimeAdapter {
  name: 'mock' | 'codex' | 'claude';
  isAvailable(): Promise<RuntimeAvailability>;
  run(input: RuntimeRunInput): AsyncIterable<RuntimeEvent>;
}

export interface RuntimeRunInput {
  conversationId: string;
  worktreePath: string;
  prompt: string;
  instructions: string;
  model: string;
  allowedTools: string[];
}

export interface RuntimeAvailability {
  installed: boolean;
  version?: string;
  path?: string;
  reason?: string;
}

export interface RuntimeEvent {
  type: 'stdout' | 'stderr' | 'status' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
}
```

### Codex/Claude Adapter

Defer exact command construction until the mock loop works. When implemented, the adapter must:

- Check CLI presence with `which codex` or `which claude`.
- Run the CLI with cwd set to the conversation worktree.
- Stream stdout/stderr line by line.
- Never pass secrets in command arguments.
- Capture non-zero exit code as conversation failure.

## 9. Implementation Phases

### Phase 0: Project Scaffold

Outcome: a runnable monorepo with web, daemon, shared package, linting, formatting, and test commands.

Tasks:

- [x] Create monorepo structure.
- [x] Add TypeScript configuration.
- [x] Add shared package.
- [x] Add web app.
- [x] Add host daemon package.
- [x] Add test runner.
- [x] Add lint/format commands.
- [x] Add `.env.example`.
- [x] Add README with local setup.

Acceptance:

- `pnpm install` succeeds.
- `pnpm lint` succeeds.
- `pnpm test` succeeds.
- `pnpm dev` starts the web app.
- `pnpm --filter host-daemon dev` starts the daemon in mock mode.

### Phase 1: Shared Schemas and Types

Outcome: all domain entities and API payloads have shared types.

Tasks:

- [x] Define enums for machine type/status, runtime, conversation type/status, run event type.
- [x] Define Zod schemas for host pairing, heartbeat, tool scan, conversation creation, run events, approval, and daemon jobs.
- [x] Export TypeScript types inferred from schemas.
- [x] Add unit tests for schema validation.

Acceptance:

- Invalid conversation type is rejected.
- Invalid runtime is rejected.
- Valid host tool scan is accepted.
- API and daemon code can import from `packages/shared`.

### Phase 2: Database and Backend Foundation

Outcome: web backend can persist workspaces, machines, projects, agents, conversations, events, and changesets.

Tasks:

- [x] Add Prisma schema with the domain model above.
- [x] Add migrations.
- [x] Add database seed script for a local demo workspace and user.
- [x] Add repository/service modules for each core entity.
- [x] Add unit tests for create/read/update operations.

Acceptance:

- `pnpm db:migrate` creates tables.
- `pnpm db:seed` creates demo data.
- Tests can create a workspace, project, agent, conversation, and run event.

### Phase 3: Host Pairing, Heartbeat, and Tool Scan

Outcome: daemon can pair with backend, heartbeat, and upload installed tools.

Tasks:

- [x] Add host setup UI that shows a pairing code.
- [x] Add backend endpoint for host pairing.
- [x] Add daemon config file support.
- [x] Add daemon `pair` command.
- [x] Add daemon `start` command with heartbeat loop.
- [x] Add tool scanner for `git`, `gh`, `node`, `python`, `codex`, and `claude`.
- [x] Store uploaded tools in `Machine.installedToolsJson`.
- [x] Show host status and installed tools in UI.

Acceptance:

- A local daemon can pair using a code from the web UI.
- Host status changes to online while daemon runs.
- UI shows installed/missing tools.
- Stopping daemon eventually marks host offline.

### Phase 4: Project and Repo Management

Outcome: user can create a project and the daemon can clone/sync the repo.

Tasks:

- [x] Add project creation UI.
- [x] Parse GitHub repo URL into owner/repo.
- [x] Store project with repo URL and default branch.
- [x] Add daemon job type `clone_repo`.
- [x] Implement safe repo path resolution under daemon workspace root.
- [x] Implement clone if missing.
- [x] Implement fetch if already cloned.
- [x] Stream clone/fetch events to backend.
- [x] Show repo sync status in UI.

Acceptance:

- Creating a project creates a clone job.
- Daemon clones the repo under the configured workspace root.
- Existing repo is fetched instead of recloned.
- Path traversal outside workspace root is rejected.

### Phase 5: Agent Configuration

Outcome: user can create and edit a project-level agent.

Tasks:

- [x] Add agent form with name, role, instructions, model, runtime, allowed tools.
- [x] Restrict runtime choices based on host tool scan, but always allow `mock`.
- [x] Store agent config.
- [x] Show project agent list.
- [x] Add validation for required instructions and runtime.

Acceptance:

- A project can have at least one agent.
- Agent can use `mock` runtime even if Codex/Claude are missing.
- Agent details are visible before starting a conversation.

### Phase 6: Conversation Creation and Job Queue

Outcome: user can start a task and backend queues daemon work.

Tasks:

- [x] Add conversation creation UI.
- [x] Let user choose task type and enter prompt.
- [x] Create conversation with status `queued`.
- [x] Create daemon job `start_conversation`.
- [x] Add daemon polling endpoint.
- [x] Add daemon job acknowledgment.
- [x] Prevent two active jobs from running at the same time on one host in MVP.

Acceptance:

- Starting a conversation creates a queued conversation.
- Daemon receives the job.
- UI shows queued/preparing/running transitions.

### Phase 7: Worktree and Branch Isolation

Outcome: every conversation runs in an isolated git worktree and branch.

Tasks:

- [x] Implement branch name generator.
- [x] Implement worktree path generator.
- [x] Add daemon git helper for `fetch`, `worktree add`, `status`, `diff`, `commit`, and `push`.
- [x] On job start, create branch from default branch.
- [x] Store branch name and worktree path on conversation.
- [x] Reject running if worktree path is outside daemon workspace root.
- [x] Add cleanup command but do not auto-delete worktrees in MVP.

Acceptance:

- Conversation never modifies default branch directly.
- Worktree exists under daemon workspace root.
- Conversation stores branch and worktree path.
- Re-running a failed setup does not corrupt existing worktrees.

### Phase 8: Mock Runtime Execution and Realtime Logs

Outcome: a full conversation run works with mock runtime and browser logs update live.

Tasks:

- [x] Implement runtime adapter interface.
- [x] Implement mock runtime adapter.
- [x] Mock runtime writes `ABITAT_RUN_LOG.md` in the worktree.
- [x] Daemon streams status/stdout/stderr events to backend.
- [x] Backend persists `RunEvent` records in sequence.
- [x] Add SSE endpoint for conversation events.
- [x] Conversation page subscribes to events.
- [x] Show event timeline and current status.

Acceptance:

- User starts a mock conversation.
- Browser shows realtime progress.
- Worktree file changes are created.
- Run events persist and reload after page refresh.

### Phase 9: Diff, Summary, and Approval

Outcome: user can review changed files and approve commit/push.

Tasks:

- [x] After runtime exits, daemon collects `git status --short`.
- [x] Daemon collects `git diff`.
- [x] Backend stores `ChangeSet`.
- [x] Conversation status becomes `awaiting_approval`.
- [x] UI shows changed files and diff.
- [x] UI shows editable commit message.
- [x] Approval endpoint records approving user.
- [x] Approval creates daemon job `commit_and_push`.

Acceptance:

- User can see exactly what changed.
- No commit happens before approval.
- Approval is recorded with user ID and timestamp.
- Invalid empty commit message is rejected.

### Phase 10: Commit, Push, and Optional PR

Outcome: approved changes are committed and pushed to GitHub.

Tasks:

- [x] Implement daemon commit operation.
- [x] Implement daemon push operation.
- [x] Store commit SHA.
- [x] Update conversation status to `pushed`.
- [x] If GitHub CLI or API credentials exist, create PR.
- [x] Store PR URL.
- [x] UI shows commit SHA and PR URL.
- [x] Add failure handling for push rejection or missing credentials.

Acceptance:

- Approved mock runtime changes are committed.
- Branch is pushed to origin.
- UI displays pushed state.
- If PR creation fails, conversation still shows pushed branch and error message for PR only.

### Phase 11: Real Runtime Adapter

Outcome: daemon can run at least one real coding-agent CLI after mock loop is stable.

Tasks:

- [x] Implement `codex` adapter if Codex CLI is installed.
- [x] Implement `claude` adapter if Claude CLI is installed.
- [x] Add runtime availability check.
- [x] Stream stdout/stderr.
- [x] Capture non-zero exit codes.
- [x] Add UI warning when selected runtime is unavailable.
- [x] Add integration test guarded by environment variable so CI can skip it.

Acceptance:

- If real CLI is missing, user sees unavailable runtime.
- If real CLI exists, daemon can launch it in the worktree.
- CLI output streams to browser.
- Failure status includes useful error message.

### Phase 12: MVP Hardening

Outcome: product is stable enough for a private demo.

Tasks:

- [x] Add cancellation support.
- [x] Add daemon restart recovery.
- [x] Mark stale running conversations as failed or recoverable after daemon reconnect.
- [x] Add basic role checks.
- [x] Add audit events for start, approval, commit, push, and failure.
- [x] Add error boundaries in UI.
- [x] Add runbook for local setup.
- [x] Add runbook for common failures.

Acceptance:

- App recovers from daemon restart.
- User cannot approve conversations outside their workspace.
- Common errors are visible in UI.
- README can guide a new developer through local demo.

## 10. Suggested UI Structure

### Workspace Dashboard

Purpose: show workspace health at a glance.

Display:

- Host status: online/offline/error.
- Installed tools.
- Projects list.
- Recent conversations.
- Primary action: create project.

### Host Setup

Purpose: let owner pair the host Mac daemon.

Display:

- Pairing code.
- Daemon install/start command.
- Connection status.
- Tool scan results.

### Project Detail

Purpose: manage repo and agents.

Display:

- Repo URL.
- Default branch.
- Last sync status.
- Agent list.
- Conversations list.
- Primary action: new conversation.

### Agent Detail

Purpose: configure reusable project-level agent.

Display:

- Name.
- Role.
- Instructions.
- Model.
- Runtime.
- Allowed tools.

### Conversation Run Page

Purpose: operate one task.

Display:

- Task prompt and type.
- Current status.
- Branch name.
- Log stream.
- Changed files.
- Diff viewer.
- Test results.
- Summary.
- Approval button.
- Commit/push/PR result.

## 11. Testing Strategy

### Unit Tests

Cover:

- Shared schema validation.
- Branch name generation.
- Safe path resolution.
- Git URL parsing.
- Runtime adapter availability checks.
- Conversation status transitions.

### Integration Tests

Cover:

- Host pairing.
- Heartbeat.
- Tool scan upload.
- Project creation.
- Conversation creation.
- Daemon job polling.
- Run event ingestion.
- Approval flow.

### Daemon Tests

Use temporary directories.

Cover:

- Clone/fetch behavior.
- Worktree creation.
- Mock runtime file change.
- Diff collection.
- Commit creation.
- Push can be tested against a local bare git repo.

### End-to-End Demo Test

Script a local demo:

1. Start web app.
2. Start daemon in mock mode.
3. Pair daemon.
4. Create project from local test GitHub or local bare repo.
5. Create mock agent.
6. Start conversation.
7. Wait for `awaiting_approval`.
8. Approve commit/push.
9. Verify branch exists and commit SHA is stored.

## 12. Environment Variables

### Web App

```bash
DATABASE_URL="postgresql://..."
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"
GITHUB_APP_ID=""
GITHUB_APP_PRIVATE_KEY=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
HOST_TOKEN_SECRET="local-dev-secret"
```

### Host Daemon

```bash
ABITAT_API_URL="http://localhost:3000"
ABITAT_HOST_TOKEN=""
ABITAT_MACHINE_ID=""
ABITAT_WORKSPACE_ROOT="$HOME/AbitatWorkspace"
ABITAT_DAEMON_POLL_INTERVAL_MS="2000"
```

## 13. Local Development Demo Script

The final MVP should support this approximate flow:

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

In another terminal:

```bash
pnpm --filter host-daemon dev pair --code ABITAT-123456
pnpm --filter host-daemon dev start
```

Then in browser:

1. Open `http://localhost:3000`.
2. Confirm host is online.
3. Create a project.
4. Create a mock agent.
5. Start a feature conversation.
6. Watch logs.
7. Review diff.
8. Approve commit and push.

## 14. Commit Strategy

Use small conventional commits:

```bash
git commit -m "chore: scaffold abitat workspace monorepo"
git commit -m "feat: add shared domain schemas"
git commit -m "feat: persist workspace project and agent models"
git commit -m "feat: pair host daemon with workspace"
git commit -m "feat: stream conversation run events"
git commit -m "feat: review and approve conversation diffs"
```

Do not combine frontend, daemon, and database changes into one large commit unless they are inseparable for a single task.

## 15. Important Product Decisions

### Decision: Build Mock Runtime First

Reason: the product value is the full control loop, not any one specific agent CLI. Mock runtime allows deterministic testing and fast iteration.

### Decision: Use Worktrees for Isolation

Reason: worktrees allow multiple branches/conversations without corrupting the main local repo checkout. This is safer than switching branches in a shared working directory.

### Decision: Approval Before Commit/Push

Reason: trust is the core product risk. The user must inspect changes before any remote GitHub mutation.

### Decision: Browser Controls, Daemon Executes

Reason: the backend should not directly access the host filesystem. The daemon owns local execution; the backend owns product state and coordination.

### Decision: Defer Telegram

Reason: Telegram is useful, but it is not required to prove the core loop. Add it once web-based run, diff, approve, and push works.

## 16. Common Failure Cases to Handle

- Host daemon offline when user starts conversation.
- Git not installed.
- GitHub repo URL invalid.
- Repo clone fails due to auth.
- Default branch does not exist.
- Worktree path already exists.
- Runtime CLI missing.
- Runtime exits non-zero.
- No files changed after run.
- Diff too large for UI.
- Commit fails because git user name/email is missing.
- Push fails due to auth or branch protection.
- PR creation fails while push succeeds.

Each failure should:

1. Update conversation status to `failed` unless the failure is non-critical.
2. Persist a `RunEvent` with type `error`.
3. Show a readable message in the UI.
4. Preserve logs and worktree for debugging.

## 17. Definition of Done for MVP

The MVP is done when:

- A new developer can run web app and daemon locally from README.
- Host pairing works.
- Tool scan is visible in UI.
- Project can be created and repo cloned.
- Agent can be configured.
- Conversation can be started.
- Worktree and branch are created per conversation.
- Mock runtime modifies a repo file.
- Logs stream live to browser.
- Diff is visible in browser.
- User approval is required before commit/push.
- Approved changes are committed and pushed to a branch.
- Conversation summary, commit SHA, changed files, and status persist after refresh.
- At least one real runtime adapter is implemented or clearly marked as unavailable based on host scan.

## 18. Recommended First Coding Agent Assignment

Give the new coding agent this first assignment:

> Build Phase 0 through Phase 2 only. Create the monorepo scaffold, shared domain schemas, database schema, migrations, seed data, and basic tests. Do not implement daemon runtime execution yet. Keep the code organized so Phase 3 can add host pairing and daemon heartbeat without restructuring.

After that succeeds, assign:

> Build Phase 3 through Phase 5. Implement host pairing, heartbeat, tool scan, project creation, repo clone job, and agent configuration. Use mock data where real GitHub auth is not available.

Then:

> Build Phase 6 through Phase 10. Implement conversation creation, daemon job polling, worktree isolation, mock runtime, realtime events, diff review, approval, commit, push, and optional PR creation.

This sequencing keeps each handoff testable and prevents the project from turning into a large half-built platform before the core loop works.
