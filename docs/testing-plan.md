# Testing

## Commands

Run builds before browser tests: rebuilding shared packages can restart the API
watcher and interrupt requests. Use development infrastructure only; fixtures
delete their own accounts, workspaces, and snapshot keys.

| Command | Coverage | Requires |
|---|---|---|
| `npm run typecheck` | All packages, services, and TypeScript tests | Installed dependencies |
| `npm test` | Permissions, credentials, document state, merges, recovery, and demo data | Installed dependencies |
| `npm run build` | Production compilation | Installed dependencies |
| `npm audit --audit-level=high` | Known dependency advisories | Registry access |
| `npm run test:showcase` | Chromium/Firefox read-only walkthrough | Installed browser binaries |
| `FLUX_TEST_FIREFOX=true npm run test:e2e` | Full-app Chromium/Firefox acceptance | Migrated development database, storage, and browser binaries |
| `npm run test:private` | Private host tooling and Compose safeguards | Python and Docker Compose |
| `npm run test:release` | Full production-mode HTTPS/SMTP/backup/restore exercise | Docker and OpenSSL; free ports 9443/8028 |
| `npm run test:release:private` | Same exercise through the private overlay | Same as the full release |
| `npm run test:release:showcase` | Frontend-only production showcase | Docker; free port 9444 |

Release exercises use frozen source, unique image tags, random project names,
disposable secrets, and local test certificates. They remove only their own
containers and volumes. Artifacts remain under `/tmp/opencode`; failed CI runs
upload diagnostics, not environment files or database archives. Update the pinned
Playwright image/version/digest in both runners with `@playwright/test`.

## What the tests protect

### Identity and permissions

Unit and browser checks cover salted password hashes, bounded password work,
credential preflights, single-use email-bound invitations, verified production
accounts, password-reset races, CSRF, tenant separation, viewer write rejection,
and active session/member revocation. Malicious Yjs writes are rejected by the
collaboration server, not just hidden in the interface.

SMTP release checks exercise authenticated TLS delivery, permanent quarantine,
temporary retry, expiry erasure, redacted HTTPS alerts, bounded operator resend,
audit events, and readiness recovery. They do not establish real inbox delivery.

### Documents and recovery

Checks cover schema round-trips, unique block IDs, checksums, private conditional
snapshot creation, ordered flush barriers, three-account editing, eight-client
release convergence, reconnect/refresh, and acknowledged-state recovery after a
collaboration process restart.

History coverage includes formatted read-only previews, append-only restore,
stale-head rejection, idempotency, concurrent restores, corrupted/unsupported
snapshot refusal, and retired room generations. Browser drafts require explicit
review; old-generation copies are download-only. Quota/storage failures do not
silently evict drafts. Tests also cover transient outages, stale acknowledgements,
account separation, cross-tab logout, and stalled account checks.

### Experiments and decisions

Merge tests cover independent changes, main-only preservation, edit/edit and
edit/delete conflicts, structural/order choices, exact-head non-author approval,
offboarding supersession, concurrent/idempotent finalization, connected-main
publication, and read-only archived experiments. Incremental updates preserve
offline edits to unaffected blocks, not intent for competing same-block edits.
Paragraph-splitting fixtures explicitly assert the native caret position before
pressing Enter and verify exact text and stable IDs; mutations are not retried to
hide incorrect edits. Text assertions exclude decorative caret labels only.

Discussion tests cover persistent sends, lost-response retries, moderation,
pagination, older linked messages, quotas, role boundaries, untrusted literal
text, revocation, and status races. Decision anchors retain original checkpoint
context and never silently reattach to a copied ID or restored generation.

### Interface and showcase

Browser checks cover day/night persistence, cross-tab themes, keyboard navigation,
dialog focus, quick open, search/sort, responsive overflow, reduced motion, and
WebGL/poster fallbacks. Decorative effects must not mutate authored content.

Showcase checks walk through all five sample views without API/sync requests,
editable fields, or accounts. They include keyboard skip links, 320px layouts,
theme persistence, and readable content without JavaScript. Its release exercise
requires a frontend-only stack, hostname-verified test TLS, production CSP,
rejected write methods, and denied account/API/document routes. Browser TLS
exceptions are limited to the disposable fixture; normal remote checks validate
certificates.

Vercel defaults to the showcase; an explicit live mode preserves backend routing.
Policy units cover automatic platform mode, route/method denial, credential
stripping, API rewrite suppression, and unchanged
full-app behavior. The Docker showcase runs the browser suite directly against
Next.js and again through HTTPS/Caddy, so a gateway cannot mask a failed application
boundary. Set `FLUX_SHOWCASE_BOUNDARY_TEST=true` with `FLUX_SHOWCASE_URL` to run the
same route checks against the public Vercel URL with normal TLS validation.

### Deployment and recovery

The full release exercises secure cookies, CSP, resource/payload limits, the
collaboration singleton lease, encrypted cold backup, empty-target restore,
restored document/checkpoint/discussion/decision state, revoked sessions,
superseded approvals, generation fencing, and populated-target refusal.

Public signup checks require email verification before issuing a session. A
verified account starts without workspace memberships, can create its own private
workspace, and cannot read or join someone else's without an email-bound
invitation. The private overlay separately retains invite-only account creation.

Private checks additionally cover private-only port/origin resolution, protected
independent secrets, Docker context isolation, startup image preflight, serialized
writer jobs, replica loss/collision refusal, backup age/disk health, notifications,
and preservation of unrelated user units. Timer templates are verified without
installation; the private release tests trusted-CA readiness and the locked host
backup wrapper.

## Validation record

On 2026-10-13, the cleaned codebase passed 96 units, 35 private-host checks,
85 application browser checks (one unsupported Firefox touch-emulation skip),
six showcase browser checks, type/build checks, and a zero-vulnerability
dependency audit. Public-app, private-overlay, and showcase Docker exercises
also passed after the dependency cleanup and separate web build. The documented
`dev:showcase` command was smoke-tested on loopback without backend services.
These results are not public deployment approval.

## Still manual

- Real public DNS/ACME, private-network ACLs/client trust, and inbox delivery.
- Actual phone/Safari/WebKit use and target hardware/storage capacity.
- Image vulnerability scans, off-host backup/key custody, and installed timers.
- Sustained editing, slow commits, and repeated failure at publication boundaries.
- Privacy, retention, deletion/export procedures, and independent security review.

Use [showcase acceptance](showcase.md), [personal acceptance](private-checklist.md),
or [the full launch checklist](launch-checklist.md) for the intended deployment.
