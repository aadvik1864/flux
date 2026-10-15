# Flux

**Write together. Try ideas. Keep your progress.**

Flux is a shared place to write and work with your team. Save your progress,
try changes in a separate copy, and review them before adding them back.
Keep your discussions and decisions beside the document.

## Try it

- **[Live app](https://flux-live-tawny.vercel.app)**: use your own private workspace.
  Anyone can sign up and confirm their email. An invitation is needed only to join
  someone else’s workspace.
- **[Demo](https://flux-showcase-three.vercel.app/demo)**: look around a sample
  workspace. No account is needed. You can explore, but you cannot edit.

Free hosting may take a little time to wake up after the app has been idle.

## What you can do

- Write together and see where your teammates are working.
- Invite people to a private workspace.
- Save versions of a document and return to earlier work.
- Try ideas in a separate copy before changing the main document.
- Discuss changes and keep a record of decisions.
- Recover browser drafts and choose a light or dark theme.

Calls, editing Office files, and replaying every edit are not available yet.

## Run it on your computer

You need Node.js and npm. Flux has been tested with Node.js 22.22.3.

### Demo

The demo uses a sample garden plan. It does not need an account, a database,
or email setup.

```bash
npm ci
npm run dev:showcase
```

Open **http://127.0.0.1:3000/demo**. This preview is available only on your computer.

### Full app

You also need Docker with Compose. Make sure ports 3000, 4000, 1234, 5438,
9010, and 9011 are free.

```bash
cp .env.example .env
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

Copy the generated value into `.env` as `COLLABORATION_SECRET`. Then run:

```bash
npm ci
npm run infra:up
npm run db:generate
npm run db:migrate
npm run dev
```

Open **http://localhost:3000**. The app and its supporting services are available
only on your computer. Local signup is open, but email is off until you set it up.
These settings are for local development.

To try working together, create a workspace and invite another email address.
Open the invitation in a separate browser profile and join with that email.
Edit the same document and wait for **Saved** before closing or refreshing it.

## Hosting and backups

| What you want | Guide |
|---|---|
| Share a demo that visitors can explore | [Demo hosting](docs/showcase.md) |
| Use Flux over a private network | [Private access](docs/private-access.md) |
| Host the full app with invitations and email | [Hosting and recovery](docs/production.md) |

Before using Flux for important work, make backups and check that you can recover
your documents.

Browser drafts are stored without encryption and may be lost. They do not replace
saved work. After restoring a document, older drafts can be downloaded but cannot
be added back through draft recovery. Saved versions cannot be changed through
the app, but they are not protected against every change to the underlying storage.
See [how Flux works](docs/architecture.md) for more details.

## Check your changes

```bash
npm run typecheck
npm test
npm run build
npm audit
npx playwright install chromium firefox
npm run test:showcase
```

Tests for the full app also need the local database and storage set up:

```bash
FLUX_TEST_FIREFOX=true npm run test:e2e
```

Build the packages before running browser tests. Do not build them while the
test servers are watching for changes. Run tests against local test data, never
the live database. See the [testing guide](docs/testing-plan.md).

## Project folders

```text
apps/web/                 Pages, editor, and demo
apps/api/                 Accounts, permissions, and document actions
apps/collaboration/       Keeps shared edits in sync
packages/shared/          Code used across the app
packages/document-model/  Document structure and change review
packages/storage/         Saves and checks document versions
deploy/                   Hosting and backup tools
tests/                    Checks for the app and hosting setup
```

[Planned features](docs/roadmap.md) · [API guide](docs/api-spec.md) ·
[Database guide](docs/database-schema.md) · [Credits and licenses](docs/ui-sources.md)
