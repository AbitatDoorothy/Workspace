# Public Hosted Mobile Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let public users install Abitat with one command, log in at `workspace.abitat.io`, pair their Mac and iPhone to the same account, and remotely control Codex from the iPhone even when the Mac and phone are on different networks.

**Architecture:** Make `workspace.abitat.io` the hosted control plane for accounts, pairing, jobs, chat sync, and push notifications. Ship a Mac CLI named `abitat` that runs a local host daemon and Codex bridge, then connects outbound to the hosted API; the iPhone app only talks to the hosted API and never connects directly to the Mac.

**Tech Stack:** pnpm monorepo, TypeScript Node CLI, existing `apps/host-daemon`, Next.js hosted web/API in `apps/web`, Prisma/PostgreSQL, Expo iOS app, npm package `bin`, Homebrew formula, hosted HTTPS/WebSocket/SSE/polling.

---

## Product Flow

The target public flow is:

```bash
brew install abitat
abitat iphone
```

Then:

1. CLI opens `https://workspace.abitat.io/login`.
2. User registers or logs in.
3. Hosted API authorizes the Mac host.
4. CLI starts the local Codex bridge and host daemon.
5. Dashboard shows this Mac as online.
6. User creates an iPhone pairing code.
7. User installs the iPhone app.
8. iPhone app defaults to `https://workspace.abitat.io`.
9. User enters or scans the pairing code.
10. Phone can start/continue Codex tasks from any network.

Direct phone-to-Mac networking is not required. The Mac daemon connects outbound to `workspace.abitat.io`, so NAT, hotel Wi-Fi, cellular, and home routers do not block remote control.

## File Structure

- Create `apps/cli/package.json`: npm package definition for `@abitat_reece/cli` with `bin.abitat`.
- Create `apps/cli/src/index.ts`: command dispatcher for `abitat login`, `abitat iphone`, `abitat doctor`, `abitat logout`.
- Create `apps/cli/src/auth.ts`: browser/device login flow and local credential storage.
- Create `apps/cli/src/doctor.ts`: environment checks for macOS, Codex binary, network, and host token.
- Create `apps/cli/src/iphone.ts`: public replacement for `scripts/dev-iphone.mjs`.
- Create `apps/cli/src/platform.ts`: macOS paths, process checks, and browser-opening helpers.
- Create `apps/cli/tests/*.test.ts`: CLI unit tests.
- Modify `package.json` and `pnpm-workspace.yaml`: include `apps/cli`.
- Modify `apps/web/prisma/schema.prisma`: add host authorization records if needed.
- Create `apps/web/app/api/hosts/register/route.ts`: account-authenticated host registration.
- Create `apps/web/app/api/cli/device-login/start/route.ts`: CLI login start endpoint.
- Create `apps/web/app/api/cli/device-login/complete/route.ts`: browser login completion endpoint.
- Create `apps/web/app/api/cli/device-login/poll/route.ts`: CLI polling endpoint for login completion.
- Modify `apps/web/server/hosts/host-service.ts`: support account-scoped host creation and host token issuance.
- Modify `apps/host-daemon/src/cli/index.ts`: accept hosted account host tokens and hosted API URL.
- Modify `apps/host-daemon/src/cli/daemon-connection.ts`: prefer CLI-managed config over demo fallback.
- Modify `apps/host-daemon/src/config/host-config.ts`: store hosted account host config.
- Modify `apps/ios/src/state/mobile-store.ts`: keep default `https://workspace.abitat.io`.
- Modify `apps/ios/src/screens/PairingScreen.tsx`: keep account-scoped pairing copy.
- Create `docs/install.md`: public install instructions.
- Create `docs/self-hosting.md`: advanced self-hosted setup.
- Create `Formula/abitat.rb` or separate `homebrew-abitat` repo formula: Homebrew packaging.

## Task 1: CLI Package Skeleton

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/tests/index.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`

- [ ] **Step 1: Write failing CLI command test**

```ts
import { describe, expect, it } from "vitest";

import { parseCommand } from "../src/index";

describe("abitat cli", () => {
  it("parses the iphone command", () => {
    expect(parseCommand(["iphone"])).toEqual({ command: "iphone" });
  });

  it("defaults to help for unknown commands", () => {
    expect(parseCommand(["nope"])).toEqual({ command: "help" });
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter @abitat_reece/cli test
```

Expected: FAIL because `apps/cli` does not exist.

- [ ] **Step 3: Add CLI package**

Create `apps/cli/package.json`:

```json
{
  "name": "@abitat_reece/cli",
  "private": false,
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "abitat": "dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@abitat_reece/shared": "workspace:*"
  },
  "devDependencies": {
    "tsx": "4.21.0",
    "typescript": "6.0.3",
    "vitest": "4.1.5"
  }
}
```

Create `apps/cli/src/index.ts`:

```ts
export type AbitatCommand = { command: "doctor" | "help" | "iphone" | "login" | "logout" };

export function parseCommand(args: string[]): AbitatCommand {
  const command = args[0];
  if (command === "doctor" || command === "iphone" || command === "login" || command === "logout") {
    return { command };
  }
  return { command: "help" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const parsed = parseCommand(process.argv.slice(2));
  console.log(`abitat ${parsed.command}`);
}
```

- [ ] **Step 4: Run CLI tests and verify GREEN**

Run:

```bash
pnpm --filter @abitat_reece/cli test
pnpm --filter @abitat_reece/cli typecheck
```

Expected: PASS.

## Task 2: Hosted CLI Login

**Files:**
- Create: `apps/cli/src/auth.ts`
- Create: `apps/cli/tests/auth.test.ts`
- Create: `apps/web/app/api/cli/device-login/start/route.ts`
- Create: `apps/web/app/api/cli/device-login/poll/route.ts`
- Create: `apps/web/app/api/cli/device-login/complete/route.ts`
- Create: `apps/web/server/auth/cli-device-login-service.ts`
- Create: `apps/web/tests/cli-device-login-service.test.ts`

- [ ] **Step 1: Write failing web service test**

```ts
it("issues a short lived CLI login code and exchanges it after browser approval", async () => {
  const service = createCliDeviceLoginService(createCliLoginDb(), {
    codeGenerator: () => "ABITAT-LOGIN",
    idGenerator: (prefix) => `${prefix}_1`,
    now: () => new Date("2026-05-07T12:00:00.000Z"),
    tokenGenerator: () => "cli_token_secret"
  });

  const login = await service.startLogin();
  expect(login).toMatchObject({ code: "ABITAT-LOGIN" });

  await service.completeLogin({ code: "ABITAT-LOGIN", userId: "user_1" });

  await expect(service.pollLogin(login.deviceLoginId)).resolves.toEqual({
    userId: "user_1",
    cliToken: "cli_token_secret"
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter web exec vitest run tests/cli-device-login-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement minimal device login service**

Add a short-lived `CliDeviceLogin` Prisma model or reuse a JSON/token table if already available. Required fields:

```prisma
model CliDeviceLogin {
  id          String    @id @default(cuid())
  codeHash    String    @unique
  userId      String?
  cliTokenHash String?
  expiresAt   DateTime
  consumedAt  DateTime?
  createdAt   DateTime  @default(now())
  @@index([expiresAt])
  @@index([userId])
}
```

Service behavior:

- `startLogin()` creates a code and returns browser URL `https://workspace.abitat.io/login?cliCode=...`.
- `completeLogin({ code, userId })` runs after browser auth.
- `pollLogin(deviceLoginId)` returns pending until approved, then returns a one-time CLI token.
- Codes expire after 10 minutes and are single-use.

- [ ] **Step 4: Implement CLI auth storage**

Create `apps/cli/src/auth.ts`:

```ts
export interface CliSession {
  apiUrl: string;
  cliToken: string;
  userId: string;
}

export function defaultApiUrl(env: Partial<Record<string, string | undefined>>) {
  return env.ABITAT_API_URL ?? "https://workspace.abitat.io";
}
```

Store credentials under:

```text
~/Library/Application Support/Abitat/config.json
```

- [ ] **Step 5: Verify login tests**

Run:

```bash
pnpm --filter web exec vitest run tests/cli-device-login-service.test.ts
pnpm --filter @abitat_reece/cli test
```

Expected: PASS.

## Task 3: Account-Scoped Host Registration

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Create: `apps/web/prisma/migrations/YYYYMMDDHHMMSS_add_host_registration/migration.sql`
- Modify: `apps/web/server/hosts/host-service.ts`
- Create: `apps/web/app/api/hosts/register/route.ts`
- Modify: `apps/web/server/hosts/request-auth.ts`
- Modify: `apps/web/tests/host-service.test.ts`

- [ ] **Step 1: Write failing host registration test**

```ts
it("registers a Mac host to the authenticated account workspace", async () => {
  const db = createHostDb();
  const service = createHostService(db, {
    idGenerator: (prefix) => `${prefix}_1`,
    tokenGenerator: () => "host_secret"
  });

  const result = await service.registerHost({
    userId: "user_1",
    workspaceId: "workspace_1",
    machineName: "Reece MacBook Pro",
    platform: "darwin"
  });

  expect(result).toEqual({
    machineId: "machine_1",
    workspaceId: "workspace_1",
    hostToken: "host_secret"
  });
  expect(db.state.machines.get("machine_1")).toMatchObject({
    ownerUserId: "user_1",
    workspaceId: "workspace_1",
    type: "host",
    tokenHash: undefined,
    pairingTokenHash: expect.any(String)
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter web exec vitest run tests/host-service.test.ts
```

Expected: FAIL because `registerHost()` does not exist.

- [ ] **Step 3: Implement host registration**

Add `registerHost(input)` to `apps/web/server/hosts/host-service.ts`.

Rules:

- Input user/workspace comes from authenticated CLI token, not request body.
- Create or reuse one host machine per user workspace for v1.
- Store only host token hash in `pairingTokenHash`.
- Return raw `hostToken` once.

- [ ] **Step 4: Add route**

`POST /api/hosts/register`:

```ts
const account = await requireCliActor(request);
const input = hostRegisterRequestSchema.parse(await request.json());
return NextResponse.json(await hostService.registerHost({
  userId: account.userId,
  workspaceId: account.workspaceId,
  machineName: input.machineName,
  platform: input.platform
}));
```

- [ ] **Step 5: Verify host registration**

Run:

```bash
pnpm --filter web exec vitest run tests/host-service.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

## Task 4: `abitat iphone` Command

**Files:**
- Create: `apps/cli/src/iphone.ts`
- Create: `apps/cli/src/processes.ts`
- Create: `apps/cli/tests/iphone.test.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/host-daemon/src/cli/daemon-connection.ts`
- Modify: `apps/host-daemon/src/config/host-config.ts`

- [ ] **Step 1: Write failing CLI test**

```ts
it("builds the hosted iphone startup plan", () => {
  expect(createIphoneStartupPlan({
    apiUrl: "https://workspace.abitat.io",
    hostToken: "host_secret",
    machineId: "machine_1",
    codexServerUrl: "ws://127.0.0.1:17321"
  })).toEqual([
    { name: "codex-app-server", command: "codex", args: ["app-server", "--listen", "ws://127.0.0.1:17321", "--analytics-default-enabled"] },
    { name: "host-daemon", command: "abitat-host-daemon", args: ["start"] }
  ]);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter @abitat_reece/cli test
```

Expected: FAIL because `createIphoneStartupPlan()` does not exist.

- [ ] **Step 3: Implement hosted startup**

`abitat iphone` must:

1. Load CLI session.
2. If no session, run `abitat login`.
3. Call `/api/hosts/register`.
4. Save host config.
5. Start Codex app-server if not already reachable.
6. Start host daemon with:

```text
ABITAT_API_URL=https://workspace.abitat.io
ABITAT_HOST_TOKEN=<host token>
ABITAT_MACHINE_ID=<machine id>
```

7. Open `https://workspace.abitat.io`.
8. Print iPhone pairing instructions.

- [ ] **Step 4: Preserve developer command**

Keep `pnpm iphone` and `scripts/dev-iphone.mjs` unchanged for local development. Public users use `abitat iphone`; maintainers use `pnpm iphone`.

- [ ] **Step 5: Verify CLI and daemon tests**

Run:

```bash
pnpm --filter @abitat_reece/cli test
pnpm --filter host-daemon test
pnpm --filter @abitat_reece/cli typecheck
pnpm --filter host-daemon typecheck
```

Expected: PASS.

## Task 5: Off-Network Codex Job Routing

**Files:**
- Modify: `apps/web/app/api/mobile/projects/[projectId]/conversations/route.ts`
- Modify: `apps/web/app/api/mobile/conversations/[id]/continue/route.ts`
- Modify: `apps/web/server/conversations/conversation-queue-service.ts`
- Modify: `apps/host-daemon/src/transport/api-client.ts`
- Modify: `apps/host-daemon/src/cli/index.ts`
- Create: `apps/web/tests/mobile-host-routing.test.ts`

- [ ] **Step 1: Write failing routing test**

```ts
it("assigns phone-started Codex jobs to the phone paired host", async () => {
  const actor = {
    machineId: "phone_1",
    userId: "user_1",
    workspaceId: "workspace_1",
    hostMachineId: "host_1"
  };

  const conversation = await createPhoneConversation({
    actor,
    projectId: "project_1",
    prompt: "Implement feature"
  });

  expect(conversation.targetMachineId).toBe("host_1");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm --filter web exec vitest run tests/mobile-host-routing.test.ts
```

Expected: FAIL if phone-started jobs are not explicitly assigned to the paired host.

- [ ] **Step 3: Implement host assignment**

Mobile-created and mobile-continued Codex turns must set `targetMachineId` to `actor.hostMachineId`. The daemon already polls by `machineId`; keep that path. If `actor.hostMachineId` is missing, reject the request with `400 Phone is not paired to a Mac host`.

- [ ] **Step 4: Verify routing**

Run:

```bash
pnpm --filter web exec vitest run tests/mobile-host-routing.test.ts tests/mobile-service.test.ts tests/conversation-service.test.ts
```

Expected: PASS.

## Task 6: Hosted iPhone Pairing UX

**Files:**
- Modify: `apps/ios/src/state/mobile-store.ts`
- Modify: `apps/ios/src/screens/PairingScreen.tsx`
- Modify: `apps/ios/scripts/validate-ios-app.mjs`
- Modify: `apps/web/app/components/pair-iphone-panel.tsx`
- Modify: `apps/web/tests/pair-iphone-panel.test.tsx`

- [ ] **Step 1: Write validation expectations**

In `apps/ios/scripts/validate-ios-app.mjs`, require:

```js
if (!mobileStore.includes('const DEFAULT_API_URL = "https://workspace.abitat.io"')) {
  throw new Error("Expected iPhone app to default to hosted Abitat API");
}
if (!pairingScreen.includes("Mac dashboard signed in to your Abitat account")) {
  throw new Error("Expected account-scoped pairing copy");
}
```

- [ ] **Step 2: Run iOS validation and verify RED if copy/default is wrong**

Run:

```bash
pnpm --filter abitat-ios test
```

Expected: PASS if current copy already matches, otherwise FAIL with the new expectation.

- [ ] **Step 3: Keep hosted default**

Ensure:

```ts
const DEFAULT_API_URL = "https://workspace.abitat.io";
```

Do not add iPhone email/password login in v1. The phone remains pairing-token based.

- [ ] **Step 4: Verify iOS**

Run:

```bash
pnpm --filter abitat-ios typecheck
pnpm --filter abitat-ios test
```

Expected: PASS.

## Task 7: Distribution Packaging

**Files:**
- Modify: `apps/cli/package.json`
- Create: `scripts/package-cli.mjs`
- Create: `Formula/abitat.rb`
- Create: `docs/install.md`
- Create: `docs/release.md`

- [ ] **Step 1: Add npm package metadata**

`apps/cli/package.json` must include:

```json
{
  "name": "@abitat_reece/cli",
  "bin": {
    "abitat": "dist/index.js"
  },
  "files": ["dist", "README.md"],
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 2: Add package smoke test**

Create `apps/cli/tests/package.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cli package", () => {
  it("publishes an abitat executable", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.bin.abitat).toBe("dist/index.js");
  });
});
```

- [ ] **Step 3: Add Homebrew formula**

Initial formula can install the npm tarball or a built standalone archive:

```ruby
class Abitat < Formula
  desc "Remote Codex control from Mac and iPhone"
  homepage "https://workspace.abitat.io"
  url "https://registry.npmjs.org/@abitat_reece/cli/-/cli-0.1.0.tgz"
  sha256 "<release-sha>"
  depends_on "node"

  def install
    system "npm", "install", "-g", "--prefix", libexec, cached_download
    bin.install_symlink Dir["#{libexec}/bin/abitat"].first
  end

  test do
    system "#{bin}/abitat", "doctor"
  end
end
```

- [ ] **Step 4: Verify package build**

Run:

```bash
pnpm --filter @abitat_reece/cli build
pnpm --filter @abitat_reece/cli test
```

Expected: PASS.

## Task 8: Hosted Deployment Readiness

**Files:**
- Create: `docs/hosting.md`
- Modify: `apps/web/package.json`
- Modify: `apps/web/server/mobile/mobile-push-service.ts` if production push config validation is missing
- Modify: `apps/web/tests/mobile-push-service.test.ts`

- [ ] **Step 1: Document required hosted environment**

`docs/hosting.md` must list:

```text
DATABASE_URL
ABITAT_SESSION_SECRET
ABITAT_PUBLIC_URL=https://workspace.abitat.io
EXPO_ACCESS_TOKEN or push notification credentials
APPLE_TEAM_ID/APNs configuration for production app builds
```

- [ ] **Step 2: Add health check route**

Create or extend `GET /api/health` to return:

```json
{
  "ok": true,
  "database": "ok",
  "publicUrl": "https://workspace.abitat.io"
}
```

- [ ] **Step 3: Verify hosted build**

Run:

```bash
pnpm --filter web build
pnpm --filter web test
```

Expected: PASS.

## Task 9: Full End-To-End Acceptance

**Files:**
- Create: `docs/acceptance/public-hosted-mobile-control.md`

- [ ] **Step 1: Write manual acceptance checklist**

```md
# Public Hosted Mobile Control Acceptance

- [ ] Fresh Mac has no Abitat config.
- [ ] `brew install abitat` installs `abitat`.
- [ ] `abitat doctor` reports missing login.
- [ ] `abitat iphone` opens browser login.
- [ ] New user registers at `workspace.abitat.io`.
- [ ] Mac appears online in dashboard.
- [ ] iPhone app opens with API URL `https://workspace.abitat.io`.
- [ ] Pairing code from dashboard pairs phone.
- [ ] Phone on cellular starts a Codex task.
- [ ] Mac daemon receives the job.
- [ ] Phone receives messages/status while off Wi-Fi.
- [ ] Phone receives completion notification.
```

- [ ] **Step 2: Run required automated verification**

```bash
pnpm --filter abitat-ios typecheck
pnpm --filter abitat-ios test
pnpm --filter web test
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter host-daemon test
pnpm --filter host-daemon typecheck
pnpm --filter @abitat_reece/cli test
pnpm --filter @abitat_reece/cli typecheck
pnpm exec prettier --check <changed files>
git diff --check
```

Expected: all commands exit 0.

## Release Order

1. Finish and commit account-linked pairing currently in progress.
2. Implement CLI package skeleton.
3. Implement hosted CLI login.
4. Implement account-scoped Mac host registration.
5. Implement `abitat iphone`.
6. Verify off-network mobile job routing.
7. Ship TestFlight iPhone build against `workspace.abitat.io`.
8. Publish npm package.
9. Publish Homebrew formula.
10. Run end-to-end acceptance on a fresh Mac and iPhone on cellular.

## Self-Review

- Spec coverage: covers single-command install, hosted registration, Mac host account linking, iPhone pairing, off-network Codex control, packaging, and acceptance.
- Placeholder scan: no implementation step depends on an undefined file without naming where it must be created. The Homebrew SHA is release-specific and intentionally produced during release packaging.
- Type consistency: plan uses `userId`, `workspaceId`, `hostMachineId`, `machineId`, `hostToken`, and `cliToken` consistently with the current codebase naming.
