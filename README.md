# Flux

**Shared work. Safe experiments. Decisions that stay connected.**

Flux is a collaborative workspace for teams. The working flow now includes
accounts → private workspace → invitation → shared document → durable save
→ named checkpoint → read-only history → restore as a new revision.

## Available now

- Email/password accounts with salted scrypt hashes and database-backed sessions.
- Private workspaces, member roles, email-bound one-use invitation links.
- Document creation and Tiptap rich-text editing, lists, headings, and tables.
- Yjs/Hocuspocus synchronization, collaborator presence, and live cursors.
- PostgreSQL recovery state and a server-confirmed **Saved** indicator.
- Read-only enforcement in the collaboration server, not only in the UI.
- Active access rechecks; idle removed members disconnect within approximately 5 seconds.
- Responsive workspace/editor UI, unit tests, and browser acceptance tests.
- Persisted day/night themes, compact layouts, document search/sorting, list/grid
  views, and keyboard quick open.
- Named, immutable document checkpoints in private S3-compatible object storage.
- Paginated history with formatted, read-only checkpoint previews.
- Explicit restore with current-head validation and automatic preservation of main.
- Server-generated checkpoint/restore activity events and schema/checksum checks.
- Restore-session fencing and downloadable local drafts when changes were not acknowledged.

**Not implemented yet:** experimental branch creation, comparison,
merging, persistent chat, Decision Bookmarks, calls, spreadsheets, presentations,
Office import/export, and fine-grained replay. The current `main` branch is a
foundation for branch-isolated sessions, not a completed branching feature.

## Local development

Requirements: Node.js 22.12+, npm, and Docker with Compose. Ports 3000, 4000,
1234, 5438, 9010, and 9011 must be available.

```bash
cp .env.example .env
# Replace COLLABORATION_SECRET with a random secret before proceeding:
node -p "require('node:crypto').randomBytes(32).toString('hex')"
npm install
npm run infra:up
npm run db:generate
npm run db:migrate
npm run dev
```

Open **http://localhost:3000**. The API and collaboration server bind to loopback.
The database is published only on `127.0.0.1:5438`.
RustFS provides local S3 storage at `127.0.0.1:9010` with its console on port 9011.
The checkpoint bucket is created privately on first use; browsers never receive
raw storage credentials or public snapshot URLs. All Compose credentials are local-only.

Invitation emails are not sent yet. Create an invitation in the workspace and
share its link manually. The recipient must register/sign in with the matching
email address before accepting it. This preview does **not** verify ownership of
an email address; email verification or a verified identity provider is required
before a public launch.

### Two-user demonstration

1. Create an account and a workspace in one browser.
2. Invite a second email using **Invite teammate** and copy the link.
3. Open that link in a separate browser profile/private window.
4. Create the invited account, then join the workspace.
5. Create/open the same document in both browsers and edit different paragraphs.
6. Wait for **Saved**, then refresh both browsers. Content should recover.

If the connection drops, keep the editor open until it reconnects and reports
**Saved**. Offline edits are held in browser memory, not persisted in IndexedDB;
closing or refreshing before acknowledgement can lose unacknowledged changes.

### Checkpoints and history

1. Wait for **Saved**, then choose **Save checkpoint** and name the moment.
2. Continue editing and optionally save more checkpoints.
3. Open **History** and select a saved version. It is a separate read-only editor,
   not a collaborative connection; selecting it never restores anything.
4. Choose **Restore as new revision** and confirm the current revision.
5. Flux saves a **Before restoring…** checkpoint and then appends **Restored…**.
   Existing checkpoints remain accessible.

If a teammate changes main during confirmation, the restore is rejected until
you refresh and review the current revision. A successful restore starts a new
room generation: older CRDT updates are not allowed into the new session. An open
draft with unacknowledged changes remains visible, read-only, with a download
option before switching to current main. The JSON download is a manual recovery
artifact; automated draft import/rebase is not implemented.

For an existing checkout, add the S3 variables from `.env.example`, run
`npm install`, `npm run infra:up`, `npm run db:generate`, and `npm run db:migrate`
before restarting the app. Existing accounts and documents are preserved.
Refresh already-open editor tabs after this upgrade; collaboration rooms now
include a generation number to fence restored sessions.

### Workspace controls

- Toggle **Day / Night** in the header. Flux initially follows your system theme;
  an explicit choice is remembered in this browser and synchronized across tabs.
- Use **Find a document**, sort by recent edits/name, or switch list/grid layouts.
- **Ctrl+K / ⌘K** opens documents in the current workspace and accessible workspaces.
  Tab through results, Enter to open, and Escape to close.
- Collapse the team rail, show/hide your password, or use **Wide page** in the editor.
  The live word count includes separate paragraphs and table cells.
- Spotlight cards and click sparks are adapted from React Bits; the circular theme
  reveal is adapted from Magic UI. Motion respects reduced-motion preferences,
  with instant theme changes on unsupported browsers. See [sources and licenses](docs/ui-sources.md).

### If workspace loading gets stuck

- Use **http://localhost:3000** and hard-refresh (`Ctrl+Shift+R`) after an update.
- Account checks time out after 10 seconds and offer **Try again** rather than
  leaving the workspace loading indefinitely.
- If browser scripts failed to load, the initial screen still has a **Reload
  page** link that works without the app's JavaScript. JavaScript must be enabled
  to sign in and use Flux.
- A successful login cancels older account checks, so a delayed signed-out
  response cannot overwrite the new session.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm audit
```

Browser tests require a running migrated database and private S3 storage
(`npm run infra:up` starts both):

```bash
npx playwright install chromium
npm run test:e2e
```

Playwright starts the app when necessary and otherwise reuses local port 3000.
It creates isolated test accounts/workspaces and deletes only the IDs created
by that run. Never point tests at a production database.

Run verification commands sequentially. Rebuilding the shared package while
browser tests use watch-mode services restarts those services and disrupts the run.

## Repository

```text
apps/web/             Next.js UI and same-origin API proxy
apps/api/             NestJS APIs, sessions, permissions, Prisma schema/migrations
apps/collaboration/   Authenticated Hocuspocus server and durable recovery writes
packages/shared/      Role rules, API types, presence utilities
packages/document-model/ Versioned editor schema and content/Yjs adapters
packages/storage/     Private S3 snapshot adapter and integrity envelope
tests/unit/           Permissions, credentials, Yjs/schema/storage primitives
tests/e2e/            Browser collaboration, history, and authorization checks
docs/                 Architecture, requirements, roadmap, testing, Office evaluation
```

## Operational boundaries

- Run **one collaboration instance**. Horizontal synchronization and distributed
  coordination are not implemented.
- Mutable Yjs recovery state remains in PostgreSQL `Bytes`; immutable checkpoint
  artifacts are stored in RustFS/S3 with checksums and metadata in PostgreSQL.
- Snapshot immutability is application-level (conditional create and no public
  mutation endpoint), not a WORM or tamper-proof audit guarantee. Storage admins
  can modify objects; checksum verification detects content changes.
- Checkpoints currently use document schema v1 and an 8 MiB object limit.
  Unsupported schemas and unverifiable objects cannot be restored.
- Storage uploads precede the metadata transaction. A failed transaction may
  leave an inaccessible orphan object; reconciliation/retention cleanup remains
  release work. No incomplete checkpoint appears in history.
- Debounced recovery writes are backed by an explicit ordered flush request.
  The UI reports **Saved** only after the corresponding database commit is acknowledged.
- This is not a production release. Email verification, password recovery,
  security review, storage limits, audit events, monitoring, and backup recovery
  exercises remain release requirements.
- The local Postgres credentials in Compose are development-only. Do not expose
  them or reuse them in production.
- `npm run infra:down` stops local infrastructure but preserves its volumes.

## Dependency notes

Versions are locked in `package-lock.json`. Vite is constrained to the tested 7.x
line to avoid an npm optional-peer resolution failure. Prisma 6's configuration
dependency `deepmerge-ts` is overridden to patched 8.x; schema validation,
client generation, and migrations must remain tested when changing this override.

See [the roadmap](docs/roadmap.md) for the next milestone.
