# Public Release

## NPM Packages

Publish in dependency order:

```sh
pnpm --filter @abitat/shared build
pnpm --filter @abitat/shared publish --access public

pnpm --filter @abitat/host-daemon build
pnpm --filter @abitat/host-daemon publish --access public

pnpm --filter @abitat/cli build
pnpm --filter @abitat/cli publish --access public
```

`pnpm pack` and `pnpm publish` rewrite workspace dependencies to the package version, so the published packages resolve as:

- `@abitat/cli -> @abitat/host-daemon`
- `@abitat/host-daemon -> @abitat/shared`

Run the local release smoke first:

```sh
pnpm smoke:public-install
```

## Hosted Web

Deploy `apps/web` to `https://workspace.abitat.io` with the environment in `docs/hosting.md`, then apply the Prisma migrations.

## iPhone App

Ship a TestFlight or App Store build with the API URL defaulting to `https://workspace.abitat.io`.

## User Flow

After release, a new user can:

```sh
npm install -g @abitat/cli
abitat iphone
```

Then they register or log in at `workspace.abitat.io`, open the iPhone app, and pair with the hosted dashboard. The phone and Mac can be on different networks because both communicate through the hosted API.
