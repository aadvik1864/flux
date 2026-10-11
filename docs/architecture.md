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
delivery comes from an encrypted transactional outbox with retry/backoff. Password
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

Unacknowledged offline edits exist only in the open browser's memory. Durable
offline storage and exact keystroke attribution are not implemented.

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

## Future merge protocol

Approval must fingerprint base/source/target revisions and the resolved result.
Finalization needs a server-enforced authoritative barrier covering WebSocket
writes as well as database updates. A brief pause can be used initially.
Apply approved changes through the live document transaction, save a checkpoint,
and publish events only after successful commit. Revalidate both branch heads.
Semantic merge application is still unimplemented; restore's generation change
must not be mistaken for a completed three-way merge algorithm.

## Production operations

The Docker kit provides HTTPS/WSS, nonce-based script CSP, private services,
non-root application images, dependency-aware health checks, limited structured
logs, account security events, bounded credential/document use, and encrypted cold
backup/restore. Restores refuse populated targets and fence old sessions/rooms.
See `docs/production.md` for the actual launch gate: real SMTP/domain validation,
off-host custody, external alerts, sustained target-hardware load, browser/device
coverage, privacy/export/deletion procedures, and independent security review.
