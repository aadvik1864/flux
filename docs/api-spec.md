# Document collaboration and history API

Browser requests use `/api` as a prefix. The Nest application receives the paths
below without that prefix. All endpoints except registration/login/logout and
health require a valid session. Mutations require the configured Origin header.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service liveness |
| POST | `/auth/register` | Create account and session |
| POST | `/auth/login` | Sign in |
| GET | `/auth/me` | Current public user |
| POST | `/auth/logout` | Revoke current session |
| GET | `/workspaces` | List memberships |
| POST | `/workspaces` | Create workspace as owner |
| GET | `/workspaces/:id` | Files and members, with caller's role |
| POST | `/workspaces/:id/invitations` | Owner/admin creates email-bound invitation |
| GET | `/invitations/:token` | Inspect an invitation for the matching account |
| POST | `/invitations/:token/accept` | Atomically consume invitation and join |
| DELETE | `/workspaces/:id/members/:userId` | Owner/admin removes non-owner member |
| POST | `/workspaces/:id/files` | Owner/admin/editor creates document |
| GET | `/files/:id` | Authorized document metadata |
| POST | `/files/:id/collaboration-token` | Issue two-minute room-scoped JWT |
| POST | `/files/:id/checkpoints` | Create a named immutable checkpoint; editing role required |
| GET | `/files/:id/checkpoints` | Paginated checkpoint list (`limit`, `cursor`) |
| GET | `/files/:id/checkpoints/:checkpointId` | Authorized, integrity-checked read-only content |
| GET | `/files/:id/history-head` | Authoritative generation/revision/content hash |
| POST | `/files/:id/checkpoints/:checkpointId/restore` | Restore with optimistic head validation |
| GET | `/files/:id/timeline` | Latest 50 server-generated history events |

Invitations expire in 48 hours. Acceptance preserves an existing member's role.
Unknown/inaccessible workspaces return 404; unauthorized actions in an accessible
workspace return 403. Used/expired invitations return 410.

REST never accepts document-content overwrites. Editing uses authenticated
Hocuspocus/Yjs messages. Stateless flush acknowledgements are persistence signals,
not history checkpoints or tamper-proof audit records.

Checkpoint creation accepts `{ title, requestId }`, where requestId is a UUID.
Restore accepts `{ requestId, expectedGeneration, expectedRevision,
expectedContentHash }` from history-head. A changed head returns 409. Successful
restore returns the new checkpoint and its preservedCheckpointId. Request IDs
are idempotent and bound to the exact action, file, and actor.

The private `/internal/history` route belongs to the collaboration service,
requires a short-lived service JWT with audience `flux-history`, and is not
exposed through the application's public API proxy.
