# Account-Linked Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email/password accounts so Mac dashboard pairing codes and paired iPhones are scoped to the same registered account.

**Architecture:** Keep browser auth cookie-based, but change the signed session payload to include `userId`. Add a small account service for password hashing, registration, login, and default workspace creation; then make web pages and pairing routes resolve workspace/user from the session instead of accepting demo ownership from forms.

**Tech Stack:** Next.js 16 route handlers and server components, Prisma/PostgreSQL, Node `crypto.scrypt`, Vitest, Expo/React Native iOS copy update.

---

### Task 1: Account Passwords And Sessions

**Files:**
- Modify: `apps/web/server/auth/session.ts`
- Create: `apps/web/server/auth/passwords.ts`
- Modify: `apps/web/tests/session.test.ts`

- [ ] **Step 1: Write failing session/password tests**

```ts
it("stores a user id in signed browser session tokens", async () => {
  const token = await createSessionToken("user_123", "secret", 60_000, 1_800_000_000_000);
  await expect(verifySessionToken(token, "secret", 1_700_000_000_000)).resolves.toEqual({
    userId: "user_123"
  });
});

it("hashes and verifies account passwords without storing plaintext", async () => {
  const hash = await hashPassword("correct horse battery staple", {
    salt: Buffer.from("0123456789abcdef0123456789abcdef")
  });
  expect(hash).not.toContain("correct horse");
  await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
});
```

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `pnpm --filter web test -- apps/web/tests/session.test.ts`
Expected: FAIL because `createSessionToken` does not accept a user id and password helpers do not exist.

- [ ] **Step 3: Implement minimal session/password support**

Use a `v2.<base64url-json>.<signature>` session token where JSON includes `userId` and `expiresAt`. Keep `verifySessionToken()` returning `false` for invalid/expired tokens. Implement password hashes as `scrypt$N$r$p$salt$hash` using `node:crypto`.

- [ ] **Step 4: Re-run targeted tests**

Run: `pnpm --filter web test -- apps/web/tests/session.test.ts`
Expected: PASS.

### Task 2: Registration And Login

**Files:**
- Create: `apps/web/server/auth/accounts.ts`
- Create: `apps/web/app/api/register/route.ts`
- Modify: `apps/web/app/api/login/route.ts`
- Create: `apps/web/app/register/page.tsx`
- Modify: `apps/web/app/login/page.tsx`
- Modify: `apps/web/proxy.ts`
- Create: `apps/web/tests/account-service.test.ts`

- [ ] **Step 1: Write failing account tests**

```ts
it("registers a user with a default workspace and owner membership", async () => {
  const db = createAccountDb();
  const service = createAccountService(db, { idGenerator: (prefix) => `${prefix}_1` });
  const result = await service.register({
    email: "Reece@Example.COM ",
    password: "correct horse battery staple",
    displayName: "Reece"
  });
  expect(result.user.email).toBe("reece@example.com");
  expect(result.workspace.ownerUserId).toBe(result.user.id);
  expect(db.state.members.get(`${result.workspace.id}:${result.user.id}`)?.role).toBe("owner");
});

it("authenticates registered users and rejects wrong passwords", async () => {
  const db = createAccountDb();
  const service = createAccountService(db, { idGenerator: (prefix) => `${prefix}_1` });
  await service.register({ email: "reece@example.com", password: "correct horse", displayName: "" });
  await expect(service.login({ email: "reece@example.com", password: "wrong" })).resolves.toBeNull();
  await expect(service.login({ email: "reece@example.com", password: "correct horse" })).resolves.toMatchObject({
    email: "reece@example.com"
  });
});
```

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `pnpm --filter web test -- apps/web/tests/account-service.test.ts`
Expected: FAIL because account service does not exist.

- [ ] **Step 3: Implement account service and routes**

Create users with normalized lowercase email, salted password hash, default workspace, and owner membership. Login route reads `email` and `password`, authenticates through the service, and sets a session token with the authenticated user id. Register route creates the account and sets the same session cookie. Add `/register` to public proxy paths and require valid `userId` in browser sessions.

- [ ] **Step 4: Re-run account/session tests**

Run: `pnpm --filter web test -- apps/web/tests/account-service.test.ts apps/web/tests/session.test.ts`
Expected: PASS.

### Task 3: Account-Scoped Dashboard And Pairing

**Files:**
- Create: `apps/web/server/auth/request-session.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/projects/page.tsx`
- Modify: `apps/web/app/projects/[projectId]/page.tsx`
- Modify: `apps/web/app/projects/[projectId]/conversations/[conversationId]/page.tsx`
- Modify: `apps/web/app/api/projects/route.ts`
- Modify: `apps/web/app/api/conversations/route.ts`
- Modify: `apps/web/app/api/mobile/pairing/start/route.ts`
- Modify: `apps/web/app/components/pair-iphone-panel.tsx`
- Create: `apps/web/tests/pairing-start-route.test.ts`

- [ ] **Step 1: Write failing pairing route test**

```ts
it("uses the signed browser session user instead of caller-provided createdByUserId", async () => {
  const sessionToken = await createSessionToken("user_account", "test-secret", 60_000, Date.now());
  const response = await POST(new Request("http://127.0.0.1:3000/api/mobile/pairing/start", {
    body: new URLSearchParams({
      workspaceId: "workspace_account",
      hostMachineId: "machine_account",
      createdByUserId: "user_attacker"
    }),
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  }));
  expect(response.status).toBe(303);
  expect(createdPairing.createdByUserId).toBe("user_account");
});
```

- [ ] **Step 2: Run targeted test and confirm failure**

Run: `pnpm --filter web test -- apps/web/tests/pairing-start-route.test.ts`
Expected: FAIL because pairing start still accepts request-owned `createdByUserId`.

- [ ] **Step 3: Implement session helpers and route scoping**

Add `getBrowserSessionUserId(request)` for route handlers and `getServerSessionUserId()` for server components. Pairing start must reject missing sessions, load the session user's default workspace/host, and call `createPhonePairing()` with `createdByUserId` from session. Project/conversation routes and pages should use session `workspaceId` and `userId`; forms can keep hidden ids for compatibility, but API routes must override them server-side.

- [ ] **Step 4: Re-run targeted web tests**

Run: `pnpm --filter web test -- apps/web/tests/pairing-start-route.test.ts apps/web/tests/projects-route.test.ts`
Expected: PASS.

### Task 4: Prisma Migration And Seed

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Create: `apps/web/prisma/migrations/20260507000000_add_account_passwords/migration.sql`
- Modify: `apps/web/prisma/seed.ts`

- [ ] **Step 1: Add schema/migration fields**

Add `User.passwordHash String @default("")` and `User.passwordUpdatedAt DateTime @default(now())`, then backfill demo users with a development password hash.

- [ ] **Step 2: Validate Prisma schema**

Run: `pnpm --filter web db:validate`
Expected: PASS.

### Task 5: iPhone Pairing Copy

**Files:**
- Modify: `apps/ios/src/screens/PairingScreen.tsx`
- Modify: `apps/ios/scripts/validate-ios-app.mjs` if string validation exists

- [ ] **Step 1: Update copy**

State that the pairing code must come from the Mac dashboard for the user's account. Do not add phone email/password login.

- [ ] **Step 2: Run iOS validation**

Run: `pnpm --filter abitat-ios test`
Expected: PASS.

### Task 6: Full Verification

**Files:** changed files only.

- [ ] **Step 1: Run required commands**

```bash
pnpm --filter abitat-ios typecheck
pnpm --filter abitat-ios test
pnpm --filter web test
pnpm --filter web lint
pnpm --filter web typecheck
pnpm exec prettier --check <changed files>
git diff --check
```

- [ ] **Step 2: Fix failures and re-run**

All commands above must exit 0 before reporting completion.
