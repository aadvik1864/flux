# Testing plan

## Automated now

Current verification (2026-10-12): 93 unit tests, 43 Chromium acceptance tests, and 42 Firefox
acceptance tests pass (one unsupported Firefox touch-emulation test is skipped), along
with type checks and the production build. Dependency audit reports no known
vulnerabilities. The expanded frozen-source Docker/HTTPS/SMTP/backup/restore
exercise also passes. These checks do not replace release security/load testing
or operator launch approval.

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
Merge units cover independent blocks, main-only preservation, edit/edit and
edit/delete decisions, structural review, insertion/movement ordering, unknown
or inherited resolutions, limits, and empty-result rejection. Incremental-update
tests keep main unchanged during preparation, preserve unaffected item identities,
converge connected replicas, and retain offline changes to an unaffected block.
Decision units cover role/input limits, nested identity inspection, copied-ID
recreation, generation fencing, and unchanged archived experiment anchors.
The production release runs `tests/release/check-document-model.cjs` across the
compiled API's CommonJS/ESM boundary, ensuring checkpoint decoding and Yjs
constructor-sensitive inspection remain inside one shared module.

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
Experiment browser tests cover isolated main/source edits, UI approval/confirmation,
exact stored-result preview despite later UI choices, connected-main publication,
stale heads, superseded and offboarded reviewers, concurrent finalization, retry
identity, corrupt base/result refusal, and download-only archived offline drafts.
Native keyboard paragraph splitting is checked on a narrow, wrapped experiment:
the existing block keeps its ID and exact content, the new paragraph receives a
different ID, and its addition combines with a main-only edit without a conflict.
Discussion tests cover two independent accounts, reopen/status persistence,
read-only highlighted checkpoint context, mobile/night/reduced-motion layout,
lost send responses, concurrent retry/sends/moderation, message/bookmark pagination,
older linked messages, tenant/role boundaries, literal untrusted text, revocation,
copy-ID recreation, main restore versus unchanged archived source, invalid saved
CRDT context, and branch/workspace limits. Quota fixtures seed bounded records or
counters only in their tracked test workspace; these are not capacity measurements.
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

## Merge acceptance and remaining stress coverage

- Non-conflicting changes on separate blocks combine.
- Conflicting edits and edit/delete cases block until resolved.
- Source or target changes invalidate approval.
- Main edits arriving during finalization do not disappear.
- Simultaneous merge attempts cannot both commit against the same head.
- Restore creates a revision; historical selection never modifies main.
- Deleted decision anchors remain visibly unavailable.

The checks above have unit/browser coverage; sustained editing during deliberately
slow finalization, repeated process failure at each commit/publication boundary,
broader mixed-format documents, and target capacity still require separate stress
evidence. Existing incremental-update tests preserve offline edits only to an
unaffected block; they do not guarantee user intent for same-block offline changes.

## Deployment acceptance

Verified identity, HTTPS/WSS, private storage, secret rotation, session revocation,
backup restore, measured small-team load, error monitoring, and documented
retention/import-export limitations. Do not claim large-scale capacity unmeasured.

`npm run test:release` creates a fresh production-mode Docker stack with local
HTTPS and a TLS-authenticated SMTP sink. Browser checks cover invite-only access,
email ownership, scanner-safe fragments, password-reset races and session revocation,
secure cookies, CSP, viewer roles, eight real concurrent WebSocket editors, durable
saving, checkpoints, explicit browser-draft recovery under production CSP,
independent verified review, live merging with retained main-only content,
archived discussion and Decision Bookmark previews,
API payload limits, and credential throttling. It also checks
the production singleton lease, makes an encrypted cold backup, restores into a
fresh project, verifies shared/recovered-draft hashes, merge checkpoints, discussion,
decision state, superseded active approvals, and generation fencing, and rejects
a second restore over existing data. See `docs/production.md`
for real domain/SMTP/monitoring/target-hardware gates this test does not cover.

The complete local release exercise passed twice consecutively on 2026-10-11,
including restored document/hash/checkpoint validation and populated-target refusal.
The expanded exercise passed on 2026-10-12, including SMTP quarantine/resend/alerts,
legacy mail expiry refusal, explicit browser-draft recovery under HTTPS/CSP,
restored shared and recovered-draft content hashes, and populated-target refusal.
The document-MVP expansion passed on 2026-10-12: compiled CommonJS/ESM identity
inspection, independent verified approval, incremental live-main merge, preserved
main/source checkpoints, archived experiment discussion/Decision Bookmark context,
and restored content/decisions with active approvals superseded and payloads erased.
Machine-local evidence: `/tmp/opencode/flux-release-awpcgzig/`; browser regression
log: `/tmp/opencode/flux-mvp-final-browser.log` (83 passed, one skipped).
The release's local TLS/SMTP/restore fixtures are supporting evidence only, not
real inbox delivery, external media networking, or target-host capacity approval.
Every application image and test script uses one frozen source snapshot and a
per-run image tag.
The mail acceptance fixture also exercises real TLS SMTP 550 quarantine, a
redacted HTTPS alert, missing-confirmation refusal, explicit resend and audit,
451 retry, expired-payload erasure, and readiness recovery after acknowledgement.
The release browser runs in a pinned Playwright container on the test network to
isolate it from host network changes; update its image/version/digest alongside
`@playwright/test`. Failed runs preserve network errors, screenshots, service logs,
container health/exit state, visible block IDs/text, and the captured merge
comparison before cleanup. Only disposable-fixture diagnostics,
not environment files or database archives, are uploaded by CI. TLS certificates
and SMTP delivery are local test fixtures, not public-domain or real-inbox validation.

Remote run `38302974522` passed unit/browser/type/build/audit checks but rejected
the release merge fixture with an `EDIT_EDIT` conflict. Captured screenshots showed
the experiment conclusion inside the original paragraph rather than a separate
addition. The release fixture now explicitly places the native browser selection
at the intended paragraph end, waits for the saved baseline, asserts the split
before typing, and verifies exact unchanged baseline content in the source
checkpoint. Conflict rules and the empty-conflict assertion remain unchanged;
mutations are not retried to hide an incorrect edit.
Exact browser text checks strip only decorative collaboration-caret widgets from
a detached DOM clone; teammate names are not authored paragraph content. The live
editor and checkpoint payloads are not modified by these assertions.
The targeted branch suite then passed all 10 checks (five Chromium and five
Firefox) on 2026-10-12; type checks, all 93 units, and the zero-vulnerability
dependency audit also passed. Browser checks run after package builds finish:
building shared packages while reusing the development server can restart its
API watcher mid-request, which caused one diagnosed local signup refusal before
the stable full targeted run. Evidence:
`/tmp/opencode/flux-ci-fixture-branches-stable.log`.
The revised complete Docker release exercise passed on 2026-10-12, including
eight-client convergence, exact baseline preservation, reviewed merging,
archived discussion/decision context, singleton fencing, encrypted restoration,
and populated-target refusal. Evidence: `/tmp/opencode/flux-release-841mh729/`
and `/tmp/opencode/flux-ci-fixture-release-final.log`.
The complete local browser suite also passed: 85 checks (43 Chromium and 42
Firefox), with the same unsupported Firefox touch-emulation skip. Evidence:
`/tmp/opencode/flux-ci-fixture-all-browsers.log`.
Remote run `38307799354` subsequently caught the same selection assumption in
the new narrow paragraph-splitting regression: `Enter` split at the clicked
position rather than the expected paragraph end. That regression now establishes
and asserts the native caret precondition explicitly before sending `Enter`;
exact content, block identity, and empty-conflict checks remain unchanged. It
does not test or claim reliability of immediate click/Ctrl+End sequencing.
The explicit-caret regression passed six fresh fixtures per browser (12 checks,
no failure retries), and type checks passed. Evidence:
`/tmp/opencode/flux-ci-caret-repeated.log`.

## Optional integration fixture

`npm run test:livekit` passed on 2026-10-12 using pinned unmodified LiveKit and a
pinned Chromium container on a disposable network with no host ports. It verifies
received microphone/camera/screen RTP packets, signature rejection, room deletion,
and inability of an unexpired retired-room token to recreate that room when
automatic creation is disabled. Fake microphone/camera inputs and automated
screen capture do not establish real device support, external ICE/TURN, or Flux
workspace/session authorization. It is not included in production Compose.
See `integration-feasibility.md` for versions, evidence, and remaining gates.

## Dependency review

The failing Vite 8.3.4 PR (#9) trace from run `38164002514` showed the optional
ribbon canvas remaining `data-motion="active"` beyond the 15-second idle assertion.
Its interpolation advanced by a fixed fraction per frame, so software/slow graphics
could stretch completion indefinitely. Motion now uses elapsed time and settles
at the next available frame after 1.2 seconds, rather than weakening or retrying the assertion.
The Vite 8.3.4 upgrade passes the current unit, type/build, audit, and Chromium/Firefox
suites locally. Its unit-test config uses `.mts` to avoid Vite's native-config ESM
warning. PR #9 is now closed; the separately tested Vite upgrade already on main
is retained, rather than merging a conflicting Dependabot branch.
Major Vite updates remain deliberate; CI verifies PRs and main pushes without
duplicating a Dependabot branch push as a second run.
