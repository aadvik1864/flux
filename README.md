# Flux

**Shared work. Safe experiments. Decisions that stay connected.**

Flux is a shared place to write, try ideas, and make decisions with your team.
Save a version of your work, explore changes in a separate copy, and review them
before bringing them back. Keep discussions and decisions beside the document.

## Try Flux online

- **[Live app](https://flux-live-tawny.vercel.app)**: open your private workspace.
  You need an invitation and a verified email address to create an account.
- **[Demo](https://flux-showcase-three.vercel.app/demo)**: explore a sample workspace
  without an account. The demo is read-only, so you can look around but cannot edit.

## What you can do

- Write together and see where your teammates are working.
- Keep documents in private workspaces and invite your team.
- Save named versions, browse earlier work, and restore a version.
- Try changes in a separate copy and review them before adding them back.
- Discuss ideas and save the reasons behind a decision.
- Recover browser drafts and switch between light and dark themes.

Calls, Office file editing, and a detailed replay of every edit are not available yet.

## Run the demo on your computer

The demo shows a sample garden plan, proposed changes, a review, discussions,
and saved versions. You do not need an account or email setup to run it.

With Node.js 22.22.3 (tested) and npm:

```bash
npm ci
npm run dev:showcase
```

Open **http://127.0.0.1:3000/demo**. The preview binds to loopback.
For a public URL, use [Vercel or the Docker showcase kit](docs/showcase.md).
It serves only the demo and its assets; real workspace routes stay unavailable.

## Run the full app locally

Docker with Compose is also required. Ports 3000, 4000, 1234, 5438, 9010,
and 9011 must be available.

```bash
cp .env.example .env
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

Put the generated value in `.env` as `COLLABORATION_SECRET`, then run:

```bash
npm ci
npm run infra:up
npm run db:generate
npm run db:migrate
npm run dev
```

Open **http://localhost:3000**. Web, API, collaboration, database, and storage
ports bind to loopback. Local signup is open; email delivery is disabled unless
SMTP is configured. These credentials and defaults are for development only.

To try collaboration, create a workspace and invite a second email. Open the
invitation in another browser profile, join with that email, and edit the same
document. Wait for **Saved** before refreshing or closing it.

## Deployment

| Use | Guide |
|---|---|
| Public read-only demonstration | [Showcase](docs/showcase.md) |
| Personal workspace over a private network | [Private access](docs/private-access.md) |
| Invite-only app with verified email and SMTP | [Production and recovery](docs/production.md) |

Both links above are online. The guides cover other ways to host Flux and keep
backups. Before relying on Flux for important work, check your backups and make
sure you can recover your documents. Free hosting may take a little time to wake
up after the app has been idle.

Browser drafts are unencrypted, best-effort recovery copies, not server saves.
Restoring a document retires its old editing generation; those drafts remain
download-only. Checkpoints are application-level immutable, not tamper-proof
storage. See [architecture](docs/architecture.md) for the guarantees and limits.

## Tests

```bash
npm run typecheck
npm test
npm run build
npm audit
npx playwright install chromium firefox
npm run test:showcase
```

Full-app browser tests require the migrated local database and storage:

```bash
FLUX_TEST_FIREFOX=true npm run test:e2e
```

Run package builds before browser tests, not while their watch-mode services are
running. Docker release and recovery checks are covered in the
[testing guide](docs/testing-plan.md). Never point tests at a live database.

## Codebase

```text
apps/web/                 Next.js interface and read-only demo
apps/api/                 NestJS API, authentication, and Prisma migrations
apps/collaboration/       Hocuspocus synchronization and durable writes
packages/shared/          Permissions and API types
packages/document-model/  Editor schema, Yjs adapters, and merge logic
packages/storage/         Private S3 checkpoints and integrity checks
deploy/                   Docker, HTTPS, and backup tooling
tests/                    Unit, browser, and deployment acceptance
```

[Roadmap](docs/roadmap.md) · [API](docs/api-spec.md) ·
[Schema](docs/database-schema.md) · [UI sources and licenses](docs/ui-sources.md)
