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
- [ ] Validate LiveKit and Office integrations in separate feasibility prototypes.

## Completed: checkpoints and history

- [x] Shared versioned document schema and stable-block validation.
- [x] Private S3-compatible storage and immutable checkpoint metadata.
- [x] Authoritative captures coordinated with live messages.
- [x] Paginated, formatted read-only history.
- [x] Restore appends a revision and preserves current main first.
- [x] Stale-head validation, idempotency, activity events, and retired-session fencing.
- [x] Automated history acceptance, integrity/schema checks, and offline draft recovery.

Exit gate passed: earlier states can be revisited without changing current content.
Verification: 39 unit tests, 13 browser acceptance tests, type checks, production
build, and a dependency audit with zero reported vulnerabilities. This remains a
development preview, not completed V1 or production-readiness certification.

## Next: branch review and safe merging

- Create experiments from main checkpoints in isolated rooms.
- Define limited block-level three-way comparison.
- Require manual resolution for ambiguous/unsupported structures.
- Pin reviewed versions, save resolutions, and record non-author approval.
- Coordinate merge finalization with the live collaboration server.
- Archive merged experiments and append resulting checkpoints/events.

Exit gate: independent changes combine; conflicts and stale reviews cannot
silently overwrite content.

## Finish distinctive MVP

Add persistent chat, review discussions, and manually created Decision Bookmarks.
Demonstrate the complete collaborate → experiment → review → merge workflow.

## Expand to Full V1

Add LiveKit calls/screen sharing and Live Merge Rooms. Select a licensed Office
integration only after the evaluation in `office-evaluation.md`. Integrate
spreadsheets/presentations and file-level snapshots; document format limitations.

## Release hardening

- [x] Invite-only production mode; verified email and one-use password recovery.
- [x] Encrypted SMTP outbox, persistent address throttles, session revocation.
- [x] Document/storage/socket limits, account security events, nonce script CSP.
- [x] Non-root Docker kit, HTTPS gateway, private services, dependency health checks.
- [x] Production collaboration singleton lease and graceful drain.
- [x] Authenticated encrypted cold backup/restore tooling with empty-target guards.
- [ ] Real hosting/domain/SMTP identity and delivery configured by the operator.
- [ ] External monitoring/alerts and off-host backup custody on the target host.
- [ ] Target-host sustained load, device coverage, privacy/deletion/export procedures.
- [ ] Independent security review before expansion beyond trusted invited teams.

The executable local release checks and launch checklist are in `docs/production.md`.
Production hardening does not implement the remaining product milestones.

Fine-grained replay, advanced Office merging, and cross-file consistency stay later.
