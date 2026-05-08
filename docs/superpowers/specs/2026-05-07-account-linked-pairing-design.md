# Account-Linked Pairing Design

## Goal

Abitat should support multiple users. A user registers with an email address and password, then pairs their Mac and iPhone under that account. The phone should only see and control devices, projects, conversations, push notifications, and remote-control sessions that belong to the same account workspace.

## Current State

The database already has the core ownership model:

- `User.email`
- `Workspace.ownerUserId`
- `WorkspaceMember`
- `Machine.ownerUserId`
- `DevicePairing.createdByUserId`

The current runtime still uses demo identity defaults such as `user_demo`, `workspace_demo`, and a shared local login password. Phone pairing codes are created from the Mac dashboard and are consumed by the iPhone, but account identity is not yet part of the user-facing onboarding flow.

## Account Model

The first implementation will use email + password registration/login.

- Registration creates or rejects by unique email.
- Passwords are stored as salted hashes, never plaintext.
- Registration creates a default workspace owned by the new user.
- The browser session stores the authenticated `userId` in a signed token.
- Existing demo seed data can remain for local development.

Email verification, invitations, password reset, and teams are out of scope for this first version.

## Host Ownership

The Mac host must become account-scoped.

- When a logged-in user opens the web app, the dashboard resolves that user's workspace.
- The local host machine record is created or reused for that workspace and `ownerUserId`.
- Host heartbeat, tool scan, and remote-control behavior stay token-based after host pairing.
- Existing Mac-only Codex behavior remains local and unaffected.

For the first version, one host per user workspace is enough. Multiple Macs per user can be added later without changing the phone pairing model.

## Phone Pairing Flow

The Mac dashboard remains the authority for creating phone pairing codes.

1. User registers or logs in on the web app.
2. User creates a phone pairing code from the Mac dashboard.
3. The pairing record stores `workspaceId`, `hostMachineId`, and `createdByUserId` from the logged-in account.
4. The iPhone enters the pairing code.
5. Pairing completion creates a client `Machine` owned by `createdByUserId`, paired to the selected host, and returns the mobile token.
6. The iPhone stores the returned token as it does today.

The iPhone does not need to know the password after pairing. The mobile token remains the device credential.

## API Authorization

Server routes should stop accepting caller-provided demo ownership for account-scoped actions.

- Browser-protected routes read `userId` from the session.
- Pairing start uses the session user instead of `createdByUserId` from request input.
- Mobile routes continue using bearer mobile tokens, but `requireMobileActor()` returns real `userId`, `workspaceId`, and `hostMachineId`.
- Project/conversation list and action routes stay scoped by `actor.workspaceId`.
- Remote-control session creation continues requiring the phone's paired `hostMachineId`.

## iPhone UX

The iPhone pairing screen should make the account relationship clear:

- Keep API URL, pairing code, and device name.
- Add copy that says the pairing code must come from the Mac dashboard for the user's account.
- No email/password entry is required on the iPhone for the first version.

If we later add phone-side login, it should be additive and should not replace the pairing-code trust boundary.

## Web UX

The web app should support:

- Register page with email, password, and optional display name.
- Login page with email + password.
- Dashboard scoped to the logged-in user's workspace.
- Pair iPhone panel showing codes generated for the logged-in user's host.

The old single shared password login should be removed from the normal flow. Local development should use the seeded demo user account instead.

## Migration

Schema changes needed:

- Add `User.passwordHash String`.
- Add `User.passwordUpdatedAt DateTime @default(now())`.

Existing demo user can receive a seeded development password hash. Existing local demo records can stay associated with `demo@abitat.local`.

## Tests

Coverage should include:

- Registration creates a user, workspace, membership, and usable session.
- Login rejects wrong passwords and accepts correct passwords.
- Pairing start uses the authenticated session user, not request-provided user ids.
- Completing phone pairing creates a phone machine owned by the pairing creator.
- Mobile actor resolution returns the paired account user id.
- Existing iOS validation covers the pairing screen copy and unchanged token storage.

## Out Of Scope

- Email verification.
- Password reset.
- Multi-user workspace invitations.
- Billing.
- Multiple hosts per account UI.
- Cloud deployment hardening beyond not using demo identity for account ownership.
