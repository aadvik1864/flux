# Testing plan

## Automated now

Current verification: 43 unit tests and 17 Chromium acceptance tests pass, along
with type checks and the production build. Dependency audit reports no known
vulnerabilities. These checks do not replace release security/load testing.

`npm test`: role separation, stable room/color utilities, salted passwords,
token hashing, safe internal redirects, CRDT convergence and deletion recovery.
History units cover schema validation/round-trips, block-ID uniqueness, checksums,
snapshot limits, conditional object creation, FIFO barriers, and room generations.
Navigation units cover trimmed/case-insensitive search, natural name sorting,
recent-edit ordering, empty results, and preserving the source list.

`npm run test:e2e`: account/workspace/document UI flow; three separate accounts
co-editing different blocks; presence; reconnection and refresh recovery;
cross-workspace denial; email-bound single-use invitations; CSRF rejection;
viewer REST rejection; direct malicious Yjs write rejection; active revocation;
acknowledged-state recovery after an isolated collaboration server is killed and restarted;
mobile editor overflow checks.

History browser tests cover named capture, read-only formatted previews,
append-only restore with preserved later content, pagination, stale-head rejection,
idempotency, simultaneous restore attempts, private objects and conditional PUT,
cross-workspace denial, service-token audience checks, unsupported schemas,
corrupt snapshots, and manual recovery of unacknowledged/offline drafts after
restoration.

Browser test fixtures delete only their own tracked database IDs and snapshot keys.
Session-loading regressions cover stalled account checks with timeout/retry,
login while an older check is pending, and recovery when browser chunks fail to
load.

Interface regressions cover system-aware day/night themes, persistence and
cross-tab synchronization, keyboard toggling, reduced motion and browser fallback,
hydration errors, password visibility, interactive document previews, search/sort,
list/grid switching, team collapse, quick-open focus/Escape/Enter, and preventing
nested dialogs. Desktop, tablet, and 320px mobile layouts are checked for overflow
and captured for visual review. Word counts handle separate blocks; wide-page
and theme controls are verified not to change document content or its history head.

## Before the next milestone is declared reliable

- Longer-running rapid editing across three independent browser accounts.
- Graceful service-restart coverage and repeated abrupt-restart stress tests.
- Temporary database unavailability: no false Saved indicator.
- Read-only accounts cannot mutate initial state through sync handshakes.
- Duplicate invitation acceptance and expired invitations.
- Logout revokes an already-open document connection.
- Formatting, tables, deletes, paste, split blocks, undo/redo, and duplicate IDs.
- Broader mobile-device, keyboard, native-dialog, and reduced-motion coverage;
  current automated browser coverage is Chromium, not Safari/Firefox.

## Future merge acceptance

- Non-conflicting changes on separate blocks combine.
- Conflicting edits and edit/delete cases block until resolved.
- Source or target changes invalidate approval.
- Main edits arriving during finalization do not disappear.
- Simultaneous merge attempts cannot both commit against the same head.
- Restore creates a revision; historical selection never modifies main.
- Deleted decision anchors remain visibly unavailable.

## Deployment acceptance

Verified identity, HTTPS/WSS, private storage, secret rotation, session revocation,
backup restore, measured small-team load, error monitoring, and documented
retention/import-export limitations. Do not claim large-scale capacity unmeasured.
