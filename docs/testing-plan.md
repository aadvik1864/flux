# Testing plan

## Automated now

Current verification (2026-10-12): 75 unit tests, 32 Chromium acceptance tests, and 31 Firefox
acceptance tests pass (one unsupported Firefox touch-emulation test is skipped), along
with type checks and the production build. Dependency audit reports no known
vulnerabilities. These checks do not replace release security/load testing.

`npm test`: role separation, stable room/color utilities, versioned salted scrypt,
legacy password compatibility, bounded password-check capacity and queue recovery,
token hashing, safe internal redirects, CRDT convergence and deletion recovery.
History units cover schema validation/round-trips, block-ID uniqueness, checksums,
snapshot limits, conditional object creation, FIFO barriers, and room generations.
Navigation units cover trimmed/case-insensitive search, natural name sorting,
recent-edit ordering, empty results, and preserving the source list.
Recovery units cover transient-versus-denied classification, bounded retries,
IndexedDB account/document/generation separation, quota refusal without eviction,
ordered writes, stale acknowledgements, unavailable storage, and logout fencing.
Credential preflight units reject invalid invitations/expired or wrong-purpose
account links before password hashing, then revalidate consumption under the user lock.
Mail units cover permanent/temporary failure classification, capped backoff,
row-locked and audited resend limits, payload erasure, and HTTPS alert configuration.

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
Browser recovery tests additionally cover initial file and token outages, manual
retry with offline edits intact, actual denial without retries, closing/reopening
an offline tab with explicit read-only review/resume, download-only old-generation
drafts after restore, storage failures with download fallback, and cross-tab logout
cleanup. The review dialog is checked at 320px in night/reduced-motion mode.

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
The reference-led entry has no-WebGL poster coverage, narrow-tablet/mobile
overflow checks, optional WebGL keyboard rotation, idle-render-loop assertions,
reduced-motion switching, and simulated context-loss fallback. Mobile navigation
checks disclosure, Escape, and returning focus to its trigger. The sculpture test
is skipped on browsers that cannot create WebGL2; poster checks still run.
Additional coverage checks functional color regions, stable document accent
colors through sorting, hover/keyboard SVG changes, reduced-motion static
graphics, touch-first document opening, onboarding creation, and graphic-mode
changes in the entry scene. Decorative interactions are verified not to mutate
document names or history heads.
The app-wide illustration family is checked in default-grid/main navigation,
creation/invitation/search dialogs, empty search states, editor/checkpoint actions,
history previews, and the email-bound invitation joining flow. Focus and mobile
dialog layouts are preserved, graphics are absent from authored document content,
and canceling the illustrated restore dialog leaves the history head unchanged.

## Before the next milestone is declared reliable

- Longer-running rapid editing across three independent browser accounts.
- Graceful service-restart coverage and repeated abrupt-restart stress tests.
- Temporary database unavailability: no false Saved indicator.
- Read-only accounts cannot mutate initial state through sync handshakes.
- Duplicate invitation acceptance and expired invitations.
- Logout revokes an already-open document connection.
- Formatting, tables, deletes, paste, split blocks, undo/redo, and duplicate IDs.
- Broader mobile-device, keyboard, native-dialog, and reduced-motion coverage;
   current automated browser coverage is Chromium/Firefox, not Safari/WebKit or
  native mobile devices.

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

`npm run test:release` creates a fresh production-mode Docker stack with local
HTTPS and a TLS-authenticated SMTP sink. Browser checks cover invite-only access,
email ownership, scanner-safe fragments, password-reset races and session revocation,
secure cookies, CSP, viewer roles, eight real concurrent WebSocket editors, durable
saving, checkpoints, explicit browser-draft recovery under production CSP,
API payload limits, and credential throttling. It also checks
the production singleton lease, makes an encrypted cold backup, restores into a
fresh project, verifies normalized shared/recovered-draft document hashes/checkpoints and generation
fencing, and rejects a second restore over existing data. See `docs/production.md`
for real domain/SMTP/monitoring/target-hardware gates this test does not cover.

The complete local release exercise passed twice consecutively on 2026-10-11,
including restored document/hash/checkpoint validation and populated-target refusal.
The expanded exercise passed on 2026-10-12, including SMTP quarantine/resend/alerts,
legacy mail expiry refusal, explicit browser-draft recovery under HTTPS/CSP,
restored shared and recovered-draft content hashes, and populated-target refusal.
Every application image and test script uses one frozen source snapshot and a
per-run image tag.
The mail acceptance fixture also exercises real TLS SMTP 550 quarantine, a
redacted HTTPS alert, missing-confirmation refusal, explicit resend and audit,
451 retry, expired-payload erasure, and readiness recovery after acknowledgement.
The release browser runs in a pinned Playwright container on the test network to
isolate it from host network changes; update its image/version/digest alongside
`@playwright/test`. Failed runs preserve network errors, screenshots, service logs,
and container health/exit state before cleanup. Only disposable-fixture diagnostics,
not environment files or database archives, are uploaded by CI. TLS certificates
and SMTP delivery are local test fixtures, not public-domain or real-inbox validation.

## Dependency review

The failing Vite 8.3.4 PR (#9) trace from run `38164002514` showed the optional
ribbon canvas remaining `data-motion="active"` beyond the 15-second idle assertion.
Its interpolation advanced by a fixed fraction per frame, so software/slow graphics
could stretch completion indefinitely. Motion now uses elapsed time and settles
at the next available frame after 1.2 seconds, rather than weakening or retrying the assertion.
The Vite 8.3.4 upgrade passes the current unit, type/build, audit, and Chromium/Firefox
suites locally. Its unit-test config uses `.mts` to avoid Vite's native-config ESM
warning. No dependency PR was merged or remote branch changed during this review.
Major Vite updates remain deliberate; CI verifies PRs and main pushes without
duplicating a Dependabot branch push as a second run.
