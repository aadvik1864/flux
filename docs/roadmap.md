# Execution roadmap

The complete V1 is not a guaranteed 28-week delivery. Progress is gated by
correctness and acceptance criteria rather than calendar dates.

## Completed: first document slice

- [x] Monorepo, web/API/collaboration services, shared permissions.
- [x] Local PostgreSQL infrastructure and reproducible migrations.
- [x] Accounts, sessions, private workspaces, invitations.
- [x] Document editing, presence, live cursors, tables, persistence.
- [x] Server-side read-only checks and session/membership revocation.
- [x] Unit tests, browser acceptance tests, production build.
- [x] Three-browser co-editing, reconnection, and acknowledged-state recovery after an abrupt service restart.
- [x] Isolated self-hosted LiveKit feasibility: two-client media/screen capture,
  invalid signatures, and retirement of an old room with an unexpired token.
- [ ] Approve a genuinely free/self-hosted Office option and validate co-editing,
  permission boundaries, persistence, callbacks, and import/export.

## Completed: checkpoints and history

- [x] Shared versioned document schema and stable-block validation.
- [x] Private S3-compatible storage and immutable checkpoint metadata.
- [x] Authoritative captures coordinated with live messages.
- [x] Paginated, formatted read-only history.
- [x] Restore appends a revision and preserves current main first.
- [x] Stale-head validation, idempotency, activity events, and retired-session fencing.
- [x] Automated history acceptance, integrity/schema checks, and offline draft recovery.

Exit gate passed: earlier states can be revisited without changing current content.
The earlier recovery release passed 75 units, 32 Chromium and 31 Firefox checks
and the isolated Docker/HTTPS/SMTP/restore exercise. New milestones require their
own regression/release record in `testing-plan.md`; earlier results do not validate
later changes. This is not completed V1 or production-readiness certification.

## Implemented: branch review and safe merging

- [x] Create experiments from main checkpoints in isolated rooms.
- [x] Limited, conservative stable-block three-way comparison.
- [x] Manual conflict/structure/order decisions.
- [x] Exact reviewed heads/result and non-author approval; offboarding supersession.
- [x] Head-validated incremental merge into connected main.
- [x] Preserved main/source/result checkpoints, archival, audit, and retry identity.

Exit gate: independent changes combine; conflicts and stale reviews cannot
silently overwrite content.

## Implemented: distinctive document MVP

- [x] Persistent branch-scoped text discussion with quotas, pagination, retry IDs,
  moderation, and viewer/archived read-only boundaries.
- [x] Manually created Decision Bookmarks with explanation/status, checkpoint,
  exact block identity, and optional linked discussion.
- [x] Deleted/recreated or restored anchors stay unavailable; original context
  remains read-only and never silently reattaches to another block.
- [x] UI workflow: collaborate → experiment → discuss → review → approve → merge.

Final acceptance is recorded separately in `testing-plan.md`. The document MVP
does not include live launch, integrated calls, or the whole planned V1.
Current local unit/browser record: 93 units, 43 Chromium and 42 Firefox checks,
with one unsupported Firefox touch-emulation test skipped; type/build/audit pass.
The expanded frozen-source Docker/HTTPS/SMTP/merge/discussion/decision and
encrypted-restore exercise also passes, including approval invalidation on restore.

## Expand to Full V1

Integrate optional LiveKit calls/screen sharing with application authorization,
revocation, and operational/device acceptance; then add Live Merge Rooms. The
passing isolated prototype is not that integration. Select an Office option
only after `office-evaluation.md` and `integration-feasibility.md` clear the
self-hosted/free and licensing constraints. Integrate
spreadsheets/presentations and file-level snapshots; document format limitations.

## Release hardening

- [x] Invite-only production mode; verified email and one-use password recovery.
- [x] Encrypted SMTP outbox, persistent address throttles, session revocation.
- [x] Document/storage/socket limits, account security events, nonce script CSP.
- [x] Non-root Docker kit, HTTPS gateway, private services, dependency health checks.
- [x] Production collaboration singleton lease and graceful drain.
- [x] Authenticated encrypted cold backup/restore tooling with empty-target guards.
- [x] Persistent browser drafts, explicit recovery, and transient-outage retry.
- [x] Invalid-link password-work preflights, mail quarantine, independent HTTPS
  notification hooks, and controlled operator resend/acknowledgement.
- [x] Personal private-network overlay, protected configuration generation,
  preflight checks, and opt-in locked backup/maintenance/health timers.
- [ ] Real hosting/domain/SMTP identity and delivery configured by the operator.
- [ ] External monitoring/alerts and off-host backup custody on the target host.
- [ ] Target-host sustained load, device coverage, privacy/deletion/export procedures.
- [ ] Independent security review before expansion beyond trusted invited teams.

The executable local release checks and launch checklist are in `docs/production.md`.
Production hardening does not replace the remaining product/launch gates.

Fine-grained replay, advanced Office merging, and cross-file consistency stay later.
