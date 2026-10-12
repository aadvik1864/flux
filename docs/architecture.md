# Architecture

## Services

- **Web:** Next.js, React, TypeScript, Tailwind; calls `/api/*` through a same-origin
  development rewrite or the production Caddy gateway.
- **API:** Modular NestJS application with PostgreSQL/Prisma. Issues sessions,
  validates membership, and signs short-lived branch-scoped collaboration tokens.
- **Collaboration:** One Hocuspocus instance. Authenticates tokens, loads Yjs
  documents, controls write access, and persists recovery state.

RustFS now provides private S3-compatible checkpoint storage locally. No
microservice fleet, Redis, LiveKit, or Office integration is required yet.

## Identity and access

Passwords use salted scrypt. Session tokens are random 256-bit values; only their
SHA-256 hashes are stored. Cookies are HttpOnly, SameSite=Lax, and Secure in
production. Mutating API requests must carry the configured `APP_ORIGIN`.
Production additionally requires verified email and invite-only signup. Email
verification/reset uses expiring, hashed one-use tokens and user-row locks. SMTP
delivery comes from an encrypted transactional outbox with capped retry/backoff,
permanent-failure quarantine, redacted best-effort HTTPS alerts, and audited
operator resend/acknowledgement. Invalid invitations/account links are rejected
before expensive password hashing; transaction-level consumption still revalidates them. Password
changes revoke all sessions/account tokens; login rechecks the password hash under
the same lock before creating its session.

Collaboration JWTs expire in two minutes, use HS256 with issuer/audience checks,
and are scoped to a single `branch:<id>:<generation>` room. Existing connections continuously
validate their underlying session and membership; JWT expiry alone does not
define the lifetime of an already-authorized connection.

Every inbound real-time message rechecks session and membership. A five-second
idle sweep handles removed members that aren't sending messages. Read-only
connections may receive state and participate in presence but cannot update
document content. Displayed presence identity is overwritten server-side with
the authenticated user's name/color.

## Document initialization

Each file has one main branch. An empty document is seeded once by the server,
not independently by every browser. The editor starts only after initial sync.
Blocks receive UUID attributes; future diff semantics need additional tests for
splits, movement, pasted blocks, nesting, and schema evolution.

The web editor, historical renderer, and sync service share document schema v1
from `packages/document-model`. Capture validates node structure and globally
unique block IDs. Historical rendering does not run the ID-assignment plugin or
create a provider. Unsupported schema versions fail explicitly.

## Persistence and acknowledgement

1. Yjs sends editor changes through the authenticated WebSocket.
2. Hocuspocus processes each connection's messages in order.
3. The browser sends a debounced flush request with a unique request ID.
4. The service captures the complete Yjs state and serializes writes per room.
5. A PostgreSQL transaction updates recovery bytes and file metadata.
6. Only after commit does the service acknowledge that request.
7. The browser reports Saved only if no newer local/received changes superseded it.

Debounced Hocuspocus storage is an additional recovery path. Full state includes
deletions; a Yjs state vector alone is not proof that every deletion was persisted.

Unacknowledged local edits are additionally backed up in IndexedDB when available,
separated by account, document, editing generation, and mounted session. Writes are
coalesced and version-checked acknowledgements cannot erase newer drafts or another
tab's copy. Recovery after reopening requires explicit read-only review and resume;
old generations are download-only. Browser backups have quotas and no retention
guarantee, are not encrypted by Flux, and do not count as server saves. Explicit
logout fences late writes and attempts account-specific cleanup across browser
tabs. Exact keystroke attribution is not implemented.

## Scaling boundary

One API process and one collaboration process are the validated topology.
Per-room write queues are process-local. Multiple collaboration instances would
need shared synchronization, authoritative ordering, and distributed coordination
before they can safely write the same document.
A dedicated PostgreSQL advisory lease enforces this limit in production. Resource
caps and rate limits are safety bounds, not advertised large-team capacity.

## Checkpoints and restore

The API issues a short-lived service JWT with a separate `flux-history` audience,
operation payload, authenticated user, and session. The loopback collaboration
HTTP endpoint independently verifies membership, session, and editing permission.
An ordinary document-connection token cannot invoke history operations.
Access is rechecked after waiting for the room barrier and again in the commit
transaction, including session expiry/revocation during a storage upload.

Every inbound WebSocket message and history operation shares a per-room FIFO
barrier. Captures therefore use the authoritative state at a defined accepted
update revision, not a possibly stale database read or client-supplied document.
S3 objects include full recovery bytes, normalized rich-text content, schema
version, and a database-referenced SHA-256 checksum. PUT uses If-None-Match: *.

Restore checks generation, accepted-update revision, and normalized content hash
against the reviewed head. It writes a before-restore snapshot and a fresh
restored snapshot, then atomically appends both checkpoint rows, increments the
room generation, updates recovery state, and records an activity event.

Recovery writes lock the Branch row and verify generation, so a delayed old-room
store cannot overwrite the restored head. Existing clients receive a restore
notification; clean editors reconnect with a fresh Y.Doc, while dirty drafts are
frozen visibly for manual download. Reconnecting old-room credentials are denied.
Request IDs make checkpoint/restore retries idempotent; a request ID cannot be
reused for a different action. Simultaneous stale restores cannot both commit.

Application immutability is not object-lock compliance. Storage administrators
retain power to mutate objects. Failed metadata commits can leave orphan uploads;
reconciliation and lifecycle policies remain to be implemented.

## Experiments and reviewed merging

Experiments clone validated main-checkpoint content into separate CRDT identities
and rooms. Their immutable base reference remains protected. The API signs a
separate `flux-branches` service credential bound to the command-body hash;
large resolution maps travel in a bounded body, not an oversized JWT header.

The coordinator serializes branch actions and acquires the workspace barrier and
both room barriers in deterministic order. Comparison is conservative at the
top-level stable-block boundary: preserve main-only changes; propose independent
simple experiment changes; require explicit edit/edit, edit/delete, structural,
and ambiguous-order decisions. No arbitrary sorting silently chooses an order.

Non-author approval fingerprints base checksum, both generation/revision/content
heads, and normalized resolved result. Finalization rechecks both live heads,
current reviewer access, and an unsuperseded approval, including inside the
workspace-row-locked commit. Offboarding invalidates approvals, so rejoining
cannot resurrect them. Re-approval releases an older result payload but keeps its audit fingerprint.

`prepareContentUpdate` clones main's existing Yjs state and prepares an incremental
`y-prosemirror` update. It does not import a fresh document under connected clients.
The transaction saves before-main, source, and result checkpoint metadata plus
recovery bytes; only after commit is that prevalidated update published to live
main. Main keeps its CRDT identities/generation. If committed publication fails,
the process fail-stops without flushing an old head; restart loads committed bytes.
The source is archived and its generation advances, fencing old drafts/credentials.
Request fingerprints make retries retrieve one committed merge.

The adapter uses pinned `y-prosemirror` internals and Yjs item identities. Dependency
changes require incremental-update, unaffected-block/offline-edit, and anchor
regression tests; this is not a general tree/character/Office merge engine.
The compiled API is CommonJS, while the document model is ESM. API callers pass
bytes to `inspectDocumentState`; they do not construct Yjs documents using a
separate CommonJS import. Decoding, schema inspection, and constructor-sensitive
identity traversal stay inside the shared module. Release acceptance exercises
this actual module boundary; dev-loader success alone would miss the mismatch.

## Discussion and Decision Bookmarks

Text discussion is PostgreSQL-backed and branch-scoped, independent of document
saving. Workspace-row-locked mutations recheck sessions/roles, reserve a monotonic
message number and byte quota, and commit before confirming send. Request IDs are
bound to author/branch/text. Removal erases current body text, retains a tombstone
and linked decisions, and records an event; retained backups may contain older text.
Visible pages poll every five seconds and stop/clear cached results after access denial.

Bookmarks bind to a same-branch immutable checkpoint, stable block ID, generation,
and the exact original Yjs item identity. Availability is checked against durable
recovery bytes, not a potentially unsaved local editor. Missing/mismatched identities
become sticky unavailable anchors; copying a block ID never reattaches a decision.
Normal text edits retain the item; a restore/backup rollback retires its generation.
Archiving retains unchanged source identities, while a later backup rollback still
fences them. Read-only original context stays accessible even when live anchors
are unavailable. Status mutations validate the expected previous status and
record events. Viewer participation and archived-branch mutations are rejected.

## Production operations

The Docker kit provides HTTPS/WSS, nonce-based script CSP, private services,
non-root application images, dependency-aware health checks, limited structured
logs, account security events, bounded credential/document use, and encrypted cold
backup/restore. Restores refuse populated targets and fence old sessions/rooms.
See `docs/production.md` for the actual launch gate: real SMTP/domain validation,
off-host custody, external alerts, sustained target-hardware load, browser/device
coverage, privacy/export/deletion procedures, and independent security review.
