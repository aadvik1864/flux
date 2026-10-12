# Document collaboration, review, and discussion API

Browser requests use `/api` as a prefix. The Nest application receives the paths
below without that prefix. Account entry/recovery endpoints and health checks
are public; workspace/document endpoints require a session (verified in production).
Mutations require the configured Origin header.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service liveness |
| GET | `/ready` | Database/storage/collaboration readiness and mail-backlog check |
| GET | `/auth/options` | Invite-only / verification settings (no secrets) |
| POST | `/auth/register` | Production: invited-address unverified signup and email link; local: create session |
| POST | `/auth/login` | Sign in |
| GET | `/auth/me` | Current public user |
| POST | `/auth/logout` | Revoke current session |
| POST | `/auth/logout-all` | Revoke all sessions; authenticated |
| POST | `/auth/request-verification` | Generic notice; send fresh 24-hour link for an unverified account |
| POST | `/auth/verify-email` | Single-use `{token, password}`; verify email, replace password, revoke sessions, sign in |
| POST | `/auth/forgot-password` | Generic notice; send 30-minute reset link for an eligible account |
| POST | `/auth/reset-password` | Single-use `{token, password}`; replace password, revoke sessions, sign in |
| GET | `/workspaces` | List memberships |
| POST | `/workspaces` | Create workspace as owner |
| GET | `/workspaces/:id` | Files and members, with caller's role |
| POST | `/workspaces/:id/invitations` | Owner/admin creates email-bound invitation |
| GET | `/invitations/:token` | Inspect an invitation for the matching account |
| POST | `/invitations/:token/accept` | Atomically consume invitation and join |
| DELETE | `/workspaces/:id/members/:userId` | Owner/admin removes non-owner member |
| POST | `/workspaces/:id/files` | Owner/admin/editor creates document |
| GET | `/files/:id` | Authorized metadata; optional `branchId` query selects editing branch |
| POST | `/files/:id/collaboration-token` | Two-minute JWT; optional `branchId` query scopes the room |
| POST | `/files/:id/checkpoints` | Create a named immutable checkpoint; editing role required |
| GET | `/files/:id/checkpoints` | Paginated list (`limit`, `cursor`, optional `branchId`) |
| GET | `/files/:id/checkpoints/:checkpointId` | Authorized, integrity-checked read-only content |
| GET | `/files/:id/history-head` | Authoritative generation/revision/hash; optional `branchId` |
| POST | `/files/:id/checkpoints/:checkpointId/restore` | Restore with optimistic head validation |
| GET | `/files/:id/timeline` | Latest 50 server-generated history events |
| GET / POST | `/files/:id/branches` | List experiments / fork a named main checkpoint |
| GET | `/files/:id/branches/:branchId` | Experiment metadata and active approvals |
| GET | `/files/:id/branches/:branchId/compare` | Authoritative base/main/experiment and conservative merge proposal |
| POST | `/files/:id/branches/:branchId/approvals` | Non-author approval of heads/resolutions/order |
| GET | `/files/:id/branches/:branchId/approvals/:approvalId` | Verified exact approved result for finalization preview |
| POST | `/files/:id/branches/:branchId/merge` | Finalize an unsuperseded approval against both exact live heads |
| GET / POST | `/files/:id/branches/:branchId/messages` | Paginated discussion / idempotent send |
| GET / DELETE | `/files/:id/branches/:branchId/messages/:messageId` | Linked message / author-or-reviewer tombstone |
| GET / POST | `/files/:id/branches/:branchId/decisions` | Paginated bookmarks / create checkpoint-bound decision |
| PATCH | `/files/:id/branches/:branchId/decisions/:decisionId` | Creator-or-reviewer status change against expected status |

Invitations expire in 48 hours. Acceptance preserves an existing member's role.
Unknown/inaccessible workspaces return 404; unauthorized actions in an accessible
workspace return 403. Used/expired invitations return 410.

REST never accepts document-content overwrites. Editing uses authenticated
Hocuspocus/Yjs messages. Stateless flush acknowledgements are persistence signals,
not history checkpoints or tamper-proof audit records.

Checkpoint creation accepts `{ title, requestId, branchId? }`, where requestId is a UUID.
Restore accepts `{ requestId, expectedGeneration, expectedRevision,
expectedContentHash }` from history-head. A changed head returns 409. Successful
restore returns the new checkpoint and its preservedCheckpointId. Request IDs
are idempotent and bound to the exact action, file, and actor.

The private `/internal/history` route belongs to the collaboration service,
requires a short-lived service JWT with audience `flux-history`, and is not
exposed through the application's public API proxy.

Fork accepts `{name, checkpointId, requestId}`. Approval accepts `{requestId,
sourceHead, mainHead, resolutions, order?}`; heads include generation/revision/hash,
and resolutions map conflict block IDs to `main`, `experiment`, or `delete`.
An explicit order must list every retained block exactly once. Finalization accepts
`{approvalId, requestId}` and returns resulting checkpoint, preservedCheckpointId,
and sourceCheckpointId. Any changed source/target head rejects the action with 409.
The separate private `/internal/branches` audience is `flux-branches`; its signed
body is capped at 256 KiB. Normal mutations remain capped at 64 KiB; approval
mutations alone allow 256 KiB. No browser supplies final document content.

Messages accept `{body, requestId}` (up to 4,000 characters). GET takes `limit`
(1–50) and optional `before` number; records are returned in ascending order with
`hasOlder`. Retry identity cannot change author, branch, or text; a retry of a
removed message returns its tombstone, never recreates its text.

Decisions accept `{title, explanation, checkpointId, blockId, discussionMessageId?,
requestId}`. References must belong to the same branch. GET takes `limit` and
optional `before`, returns `nextBefore`, and checks last-durable anchor availability.
It may stamp unavailable-anchor metadata, never edit content or restore a checkpoint.
PATCH accepts `{status, expectedStatus}` with `OPEN`, `DECIDED`, or `SUPERSEDED`.
Conflicting status changes return 409. Viewers read only; archives reject new
messages/bookmarks/status changes. Authorized text moderation remains possible.

Production registration accepts `{name, email, invitationToken}`. The invitation
must be an unexpired matching signup/workspace invitation. It creates no session;
the password is chosen on the email verification page, not trusted from signup.
Account-token consumption serializes on the user row, deletes all account tokens
and sessions, and creates the new session in the same transaction. Password changes
cannot race an old-password login into creating a valid new session.
