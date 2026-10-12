# Flux

**Shared work. Safe experiments. Decisions that stay connected.**

Flux is a collaborative workspace for teams. The working flow now includes
accounts → private workspace → invitation → shared document → durable save
→ named checkpoint → isolated experiment → discussion → reviewed merge
→ Decision Bookmark, with read-only history and restore-as-new-revision.

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
- Reference-led slate/coral/orchid identity, self-hosted typography, and an original
  interactive ribbon sculpture on the entry screen with a static mobile fallback.
- Named, immutable document checkpoints in private S3-compatible object storage.
- Paginated history with formatted, read-only checkpoint previews.
- Explicit restore with current-head validation and automatic preservation of main.
- Server-generated checkpoint/restore activity events and schema/checksum checks.
- Restore-session fencing and downloadable local drafts when changes were not acknowledged.
- Persistent browser draft backups with explicit review/resume; older restored
  generations are download-only and never replayed automatically.
- Bounded retry for temporary connection failures without false access denial.
- Checkpoint-based experiments, isolated editing rooms, conservative stable-block
  three-way comparison, explicit conflict/order choices, and non-author approval.
- Incremental, head-validated merges into connected main; preserved main/source
  checkpoints, archived experiments, and idempotent finalization.
- Persistent branch-scoped discussion, lost-response send recovery, moderation,
  and read-only archived discussions.
- Manually created Decision Bookmarks linking an explanation, checkpoint, exact
  block identity, and optional discussion; deleted anchors never reattach to copied IDs.

**Still separate milestones:** integrated calls/Live Merge Rooms, spreadsheets,
presentations, Office import/export, richer anchored comments, and fine-grained
replay. The isolated LiveKit feasibility fixture is not a Flux call feature.
This remains a locally tested, invite-only document MVP, not completed V1 or live-launch approval.

## Local development

Requirements: Node.js 22.22.3 (tested), npm, and Docker with Compose. Optional
LiveKit prototype SDK dependencies require Node 22.22+. Ports 3000, 4000,
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

Local defaults allow direct signup and manually shared invitations for demos.
The production Docker kit requires **invite-only signup, verified email, and
authenticated TLS SMTP**. It delivers invitations, verification, and password
recovery through an encrypted retryable outbox. Local demo email is disabled
unless SMTP is configured; an email string alone is not verified identity.
Permanent delivery failures are quarantined with redacted operator alerts and
explicit, bounded resend commands. See the production runbook before closing or retrying a failure.

## Production deployment kit

Use [the deployment and recovery runbook](docs/production.md) for the current
document MVP. `deploy/` includes non-root images, a private database
and snapshot service, a same-origin HTTPS/WSS gateway, health checks, resource
limits, a single-sync-server lease, and authenticated encrypted backup/restore.
`npm run test:release` exercises a separate production-mode Docker stack.

**Not live yet:** your domain/server, SMTP sender, external alerts, off-host
backups, and the runbook's launch gate still need configuration and validation.

### Two-user demonstration

1. Create an account and a workspace in one browser.
2. Invite a second email using **Invite teammate** and copy the link.
3. Open that link in a separate browser profile/private window.
4. Create the invited account, then join the workspace.
5. Create/open the same document in both browsers and edit different paragraphs.
6. Wait for **Saved**, then refresh both browsers. Content should recover.

If the connection drops, keep the editor open until it reconnects and reports
**Saved**. Flux also backs up unsaved local edits in IndexedDB when browser storage
is available. On returning, review a recovery copy before choosing to resume it.
These are not server saves: browser eviction, cleared data, private browsing, or
closure before a backup finishes can still lose work. Download a copy if a backup
warning appears. Browser drafts are not encrypted by Flux; clear site data after
using a shared device.

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
artifact. A persisted draft from the same editing generation can be resumed after
explicit review; a draft from before a restore is download-only. Office-file import
and automatic cross-generation draft rebasing are not implemented.

For an existing checkout, add the S3 variables from `.env.example`, run
`npm install`, `npm run infra:up`, `npm run db:generate`, and `npm run db:migrate`
before restarting the app. Existing accounts and documents are preserved.
Refresh already-open editor tabs after this upgrade; collaboration rooms now
include a generation number to fence restored sessions.

### Experiments, review, and decisions

1. Save a main checkpoint. An owner/admin/editor opens **Experiments** and creates
   an experiment from it. Work in that room leaves main unchanged.
2. Save experiment checkpoints when you need decision context. Open
   **Discussion & decisions** to exchange persistent text and create a bookmark.
   Unsent chat text is not backed up; send before leaving.
3. Open **Review merge**. Review base, main, experiment, and the proposed result.
   Competing edits, edit/delete cases, experiment-side list/table changes, and
   ambiguous ordering need explicit whole-block/order choices.
4. A different owner/admin/reviewer approves the exact heads and result. The
   creator cannot approve their own experiment. Any new edit invalidates approval.
5. A merge-capable teammate chooses **Finalize approved merge**, reviews the exact
   stored approved result, and confirms. Flux preserves main/source checkpoints,
   incrementally updates live main, and archives the experiment.

Main keeps its editing generation during a merge. The source generation retires:
unsent experiment drafts become download-only, never replayed into archived content.
Bookmarks show anchor availability from the last durable save and retain original
read-only checkpoint context if a block disappears. A recreated block with a copied
ID is not the original anchor. Status changes are explicit and audited.

Merge review is limited to 1,000 top-level blocks. This is not character-level or
Office semantic merging, nested branching, repeated merges, or perfect authorship.

### Workspace controls

- Toggle **Day / Night** in the header. Flux initially follows your system theme;
  an explicit choice is remembered in this browser and synchronized across tabs.
- Use **Find a document**, sort by recent edits/name, or switch layouts. The
  illustrated grid is the default; List view keeps larger collections compact.
- **Ctrl+K / ⌘K** opens documents in the current workspace and accessible workspaces.
  Tab through results, Enter to open, and Escape to close.
- Collapse the team rail, show/hide your password, or use **Wide page** in the editor.
  The live word count includes separate paragraphs and table cells.
- The entry uses Uiverse-derived liquid-fill controls and a GSAP headline reveal.
  The optional locally rendered ribbon sculpture responds to pointer movement
  and a keyboard-accessible rotation button. Mobile, reduced-motion, low-bandwidth,
  or WebGL-unavailable sessions keep the immediate local WebP artwork instead.
- Mobile workspace navigation is tucked behind the menu button; document actions
  remain directly accessible. Artwork stays in editor controls, never inside the
  shared document.
- Document drawings unfold on hover or keyboard focus; checkpoint illustrations
  gather into a saved stack. The entry preview changes the sculpture arrangement.
  Touch/reduced-motion sessions keep static artwork; essential actions never
  depend on hovering. These effects do not change document content or history.
- The same original folder/page/person illustration family appears in the main
  workspace heading, left navigation, search states, creation dialogs, invitations,
  account recovery screens, editor history actions, and checkpoint previews.
- Spotlight cards/click sparks are adapted from React Bits; the circular theme
  reveal is adapted from Magic UI. Motion respects reduced-motion preferences,
  with instant theme changes on unsupported browsers. Fonts and artwork are
  self-hosted. See [sources and licenses](docs/ui-sources.md).

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
# Optional Firefox coverage:
npx playwright install firefox
FLUX_TEST_FIREFOX=true npm run test:e2e
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
tests/integrations/   Optional isolated LiveKit feasibility fixture
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
- Production hardening and deployment tooling are implemented for this feature
  slice, but real hosting/email/alerts and target-environment validation are still
  operator launch requirements. This is not a completed Flux V1 or a security certification.
- The local Postgres credentials in Compose are development-only. Do not expose
  them or reuse them in production.
- `npm run infra:down` stops local infrastructure but preserves its volumes.

## Dependency notes

Versions are locked in `package-lock.json`. Vite 8.3.4 is verified with the unit,
browser, type/build, and production release suites; future major upgrades require
deliberate review. Prisma 6's configuration
dependency `deepmerge-ts` is overridden to patched 8.x; schema validation,
client generation, and migrations must remain tested when changing this override.

See [the roadmap](docs/roadmap.md) for the next milestone.
See [integration feasibility](docs/integration-feasibility.md) for the self-hosted/free
constraint and remaining calls/Office gates. `npm run test:livekit` runs only a
disposable Docker prototype, publishes no host ports, and uses generated test keys.
