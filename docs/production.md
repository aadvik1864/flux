# Invite-only production deployment

For a public demonstration without accounts or real data, use `docs/showcase.md`.
Its standalone Compose file runs only the web preview and HTTPS gateway.

For a personal project on an existing machine, use `docs/private-access.md` instead
of publishing this public-host configuration. It overlays the same application
protections with private-IP-only HTTPS and small host jobs. Do not start this base
Compose file alone when you intend private-only access.

This kit deploys the **document MVP with history, experiments, review, discussion,
and Decision Bookmarks**, not the full
planned Flux V1. Run one API, one web server, and one collaboration server on a
single Linux host. The Docker test uses disposable local certificates and an SMTP
test sink; it does not establish real-world email delivery, public ACME issuance,
or capacity on your server. Complete the launch checklist below before use.

## Host and configuration

- Linux server with Docker and Compose 2.24.4+, 4 vCPU / 8 GiB RAM as an initial
  sizing estimate, SSD storage, and a domain with correct A/AAAA records.
- Open only TCP 80/443 and restricted administrative SSH. Do not publish the
  database, RustFS console, API, or collaboration ports. The kit only publishes
  the HTTPS gateway. If an AAAA record exists, the server must be reachable over IPv6.
- An authenticated SMTP provider: STARTTLS on 587 or implicit TLS on 465. Configure
  SPF, DKIM, and DMARC for the sender domain. Test delivery to your actual users.
- Python 3.12+, OpenSSL, and an independently generated backup encryption key
  stored off-server. Backups are meaningless without that key and an off-host copy.

```bash
cp deploy/.env.example deploy/production.env
chmod 600 deploy/production.env
node -p "require('node:crypto').randomBytes(32).toString('hex')"
# Generate each secret separately; enter real domain, SMTP details, and release tag.
```

Use random hexadecimal values for the PostgreSQL passwords (they are interpolated
into a connection URL), storage secret, collaboration secret, and mail encryption
key. Never use the example credentials. Docker/environment secrets are visible to
host administrators; do not grant untrusted users Docker access.

The database initializer creates a non-superuser `flux_app` role. The separate
`flux_admin` credential is used only for initialization and backup/restore.
Application schema migrations run as `flux_app`. RustFS credentials have storage
administrator power but are isolated inside the private Docker network; browsers
receive neither credentials nor public checkpoint links.

## First deployment

Commands run from the repository root. No command automatically deletes volumes.

```bash
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml --profile operations build
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml up -d --wait postgres object-storage
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml run --rm migrate
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml run --rm --no-deps tools node dist/operations.js smtp-check
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml up -d --wait
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml run --rm --no-deps tools node dist/operations.js invite owner@your-domain.com
```

The first owner receives an email-bound, 48-hour signup invitation. Signup creates
an unverified account without a usable password/session. The recipient's 24-hour
email verification link lets them choose their own password. Only then can they
create a workspace. Workspace owners/admins invite teammates through the UI;
those links also authorize invited-address signup. Reopen the workspace invitation
after verifying to join it. A valid invitation is not proof of email ownership.

Existing development/imported accounts are **not** silently marked verified.
They must request a verification link and choose a new password before production
access. Verification and 30-minute password-reset links are single-use and opening
a link never consumes it. A reset deletes all existing sessions and other account
tokens; active collaboration authorization catches revocation within about five
seconds. Recovery requests return the same notice for eligible/unknown addresses.

SMTP delivery uses an encrypted, database-transactional outbox. A single API worker
retries temporary failures with capped exponential backoff (at most 12 attempts), erases payloads after delivery,
and logs message IDs rather than addresses/links. Delivery is at-least-once, so a
crash after SMTP acceptance can produce a duplicate email. An older verification
link becomes invalid when a new one is requested. Do not scale the API worker.

### Mail quarantine and controlled resend

SMTP 5xx rejections, authentication failures, unreadable payloads, and exhausted
retries go into quarantine rather than retrying forever. Expired links are not sent;
their payloads are erased. The migration cannot infer expiry for older queued mail,
so those messages are quarantined and erased too: request fresh links after upgrading.
Unacknowledged quarantine makes `/ready` fail immediately. Structured logs and
security events contain message IDs/failure categories, never recipients or links.

Optionally set `MAIL_ALERT_WEBHOOK_URL` to an **HTTPS** endpoint accepting a JSON POST
with `service`, `event`, `messageId`, `kind`, and `attempts`. The request validates TLS,
does not follow redirects, and has a five-second timeout. This is a best-effort
notification, not a durable alert-delivery queue: also monitor readiness and
`mail_alert_failed` logs through an independent channel. Endpoint credentials, if
included in the URL path/query, belong in the protected production environment
only. URL userinfo (Basic credentials) and fragments are rejected.

```bash
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml run --rm --no-deps tools node dist/operations.js mail-status
# Diagnose and fix SMTP first. Choose ONE action for the message ID from status:
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml run --rm --no-deps tools node dist/operations.js mail-retry MESSAGE_ID --confirm-resend
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml run --rm --no-deps tools node dist/operations.js mail-acknowledge MESSAGE_ID --confirm-close
```

Retry is row-locked, audited, and limited to three explicit resend requests per
message. It requires an unexpired, readable retained payload. Sent, expired, or
acknowledged messages cannot be resent; request a fresh recovery link or invitation
instead. Acknowledge closes the failure and erases the payload, without delivery.
Status shows at most 100 open quarantines; repeat after resolving those shown.

## Health, limits, and alerts

- New passwords use versioned scrypt (`N=131072, r=8, p=1`). Legacy local hashes
  remain readable and upgrade on a successful login. Password work is limited to
  two active checks and 16 queued checks per API process; excess load gets 503
  instead of allocating unbounded native memory.
- API `/health`: liveness. `/ready`: database, snapshot bucket, sync readiness,
  no pending mail older than 15 minutes, and no unacknowledged quarantines. Public prefix is `/api`.
- Collaboration `/ready`: private database/storage readiness. The public gateway
  accepts only WebSocket upgrades under `/sync`; `/internal/*` is not public.
- Docker restarts exited services, **not merely unhealthy ones**. Add an external
  uptime monitor for `https://YOUR_DOMAIN/api/ready`, and alert on unhealthy
  containers, restart loops, mail failures/backlog, backup failures, and disk usage
  above 70% (urgent at 85%). Send alerts somewhere other than Flux's own SMTP queue.
- Request logs contain generated IDs, route templates, status, and latency—not
  raw token-bearing URLs or request bodies. Unexpected failures omit database
  internals from clients/logs. Gateway access logging is deliberately not enabled.
- Auth: 60 requests/IP/15 minutes in one API process, plus a persistent
  10-attempt/address/operation/15-minute throttle. General API: 300/IP/minute.
  Trust exactly the one private Caddy hop. If adding a CDN/proxy, review the trust
  chain and retest spoofed forwarding headers before launch.
- Quotas: 20 owned workspaces/account; 100 documents, 100 members, and 100 pending
  invitations/workspace; 1,000 checkpoints/branch; 256 MiB referenced checkpoint
  bytes/workspace; 8 MiB recovery state/snapshot. Restores reserve both snapshots.
- Experiments: at most 20 active / 100 lifetime experiments per document;
  comparison supports 1,000 top-level blocks. Merge reserves three snapshots.
  Branch work has a 16-request coordinator queue. Approvals: 10 active/experiment,
  1,000 lifetime/workspace, 64 MiB active payloads/workspace; supersession/merge
  releases old payloads. Limits are deliberate MVP safety bounds, not capacity promises.
- Discussion: 4,000 characters/message, 10,000 lifetime messages/branch,
  64 MiB live text/workspace; 500 Decision Bookmarks/branch and 1,000/workspace.
  Five-second visible-page polling is not a WebSocket chat/delivery guarantee.
  Unsent message text is not browser-backed up. Moderation erases current text;
  existing backups may retain it until the operator's retention policy removes them.
- Runtime caps: 100 sockets, 50 active documents, 2 MiB messages; each authenticated
  connection is capped at 1,200 messages / 16 MiB per minute. These are safety caps,
  not a demonstrated 100-user capacity guarantee. Yjs state includes deletion
  history, so its size can grow even when the visible document shrinks.
- A dedicated database advisory lock fences a second production collaboration
  process. Losing that lease exits the process. No horizontal scaling or rolling
  sync-server overlap is supported. Plan short maintenance windows.

Run daily maintenance (using cron/systemd on the host):

```bash
docker compose --env-file deploy/production.env -f deploy/compose.prod.yaml run --rm --no-deps tools node dist/operations.js maintenance
```

It removes expired sessions/account tokens/throttles, old signup invitations and
mail rows (30 days), and security events after 90 days. Document/checkpoint data
is not deleted. It also erases expired quarantined payloads; run it daily even when
delivery is healthy. Failed checkpoint commits can leave orphan storage objects; monitor
physical storage separately from referenced-byte quotas. Do not automatically
delete objects based only on an unreviewed inventory or bucket lifecycle rule.

## Encrypted backup and restore

Backups stop the gateway, API, and collaboration process, flush sync state, then
export PostgreSQL and **every referenced checkpoint**, verifying checksums. They
resume the previously running services even if export fails. This is a cold backup:
expect a maintenance window. Writes by external database/storage administrators
must also be stopped. The resulting archive uses AES-256-GCM authenticated encryption.

```bash
# Set independently generated FLUX_BACKUP_KEY in your secure shell/secret manager.
python3 deploy/backup.py backup backups/flux-2026-10-11.flux
```

Move it off-host and confirm upload success; alert on failures. A starting policy
is daily backups, 7 daily and 4 weekly off-host copies, with a monthly recovery
exercise. This means **up to 24 hours' data loss** without more frequent backups
or PostgreSQL PITR. Retention, RPO, and RTO are operator decisions, not guarantees.

Restore only into a **new, empty project**. It refuses any existing public database
tables or snapshot objects and never drops an existing database/bucket:

```bash
docker compose --env-file deploy/production.env --project-name flux-recovery -f deploy/compose.prod.yaml up -d --wait postgres object-storage
python3 deploy/backup.py restore backups/flux-2026-10-11.flux --project flux-recovery --confirm-empty
```

Use the image/release tag that created the backup before migrating newer versions.
Restore validates encryption, archive paths, database checksum, restored checkpoint
metadata, migration metadata, and snapshot checksums. It then revokes sessions,
account/invitation links and queued emails, supersedes active merge approvals,
erases their result payloads, and advances all room generations.
Users must sign in again, and owners must recreate pending invitations. It does
not start public services. Verify accounts, document contents, historical previews,
permissions, and readiness in isolation before switching traffic. A partial failed
restore stays offline; retry in another fresh project rather than wiping the target.

Keep the production environment/SMTP settings and backup key securely available
off-host; the archive does not contain configuration files, S3 orphan objects, or
Caddy's certificates. A fresh gateway can obtain new public certificates.

## Upgrades and secret rotation

1. Take an off-host verified backup and retain old images/configuration.
2. Build/tag all images, stop gateway/API/sync, run reviewed migrations, then start
   sync → API → web → gateway and check readiness. Refresh old editor tabs.
3. Never blindly roll back code after a schema migration. Use a compatible forward
   fix or the isolated restore procedure; don't overwrite live data.
4. Rotate collaboration secrets during coordinated API/sync restart. Revoke sessions
   if identity secrets are compromised. Changing database/storage credentials also
   requires updating the actual database/storage account—not only an env file.
5. Drain the outbox before changing its encryption key; pending messages need the
   old key. Keep backup keys for every retained backup. Test rotation in staging.

## Launch gate

Record actual evidence using `docs/launch-checklist.md`. These gates require the
operator's server, domain, SMTP identity, and decisions; local fixtures cannot satisfy them.

- [ ] Real domain/server/firewall configured; trusted public HTTPS/WSS tested.
- [ ] Real SMTP identity/delivery tested, SPF/DKIM/DMARC and recovery verified.
- [ ] Independently generated secrets and off-host configuration/key custody.
- [ ] External uptime, disk, mail, error, and backup alerts configured and tested.
- [ ] Off-host backup uploaded, restored, and content/permissions checked on target hardware.
- [ ] Sustained expected-team editing and reconnection tested on target hardware.
- [ ] Browser/device support agreed; Safari/WebKit/device testing if required.
- [ ] Operator privacy policy, contact, retention, export/deletion procedure agreed.
- [ ] Independent security review before expanding beyond trusted invited teams.
- [ ] Image vulnerability scan and license suitability reviewed, especially React
  Bits' MIT + Commons Clause and GSAP's Standard No Charge license.

`npm run test:release` runs an isolated production-mode Docker/HTTPS/SMTP/browser
exercise and an encrypted restore drill. It generates its own random project names,
secrets and local certificates; ports 9443/8028 must be free. It deletes only those
test projects' volumes. Never substitute your live environment into this test.
The expanded document-MVP exercise passed locally on 2026-10-12, including verified
independent review, live-main merging, archived discussion/decision context, and
encrypted restore of content/checkpoints/decisions with active approvals invalidated.
This does not satisfy the real-world launch gates above.

The current scope still excludes integrated calls/Live Merge Rooms, Office editing,
and richer anchored comments/replay. The optional LiveKit feasibility fixture is
isolated and not included in this production stack. Office licensing is unresolved;
see `docs/integration-feasibility.md`. Users must wait for **Saved** before closing the editor. IndexedDB
backs up unacknowledged local edits when available (8 MiB/draft, 32 MiB/account,
64 MiB/browser, 64 records). Capacity exhaustion never silently evicts a draft;
users get a warning and can download or discard copies. On returning, drafts require
explicit review/resume; drafts from a different room generation are download-only.
Live-session reconnection still synchronizes edits in the same generation normally.
Transient token/file outages have bounded retry and a manual retry button, not false
access denial; actual authorization failures stop reconnection.

Browser drafts are **not encrypted by Flux** and account separation is an application
boundary, not protection against someone controlling the browser profile. They have
no guaranteed retention: browser eviction, cleared data, private browsing, or closure
before a backup completes can lose work. Explicit logout attempts account-specific
cleanup and broadcasts logout to same-browser tabs; purge failures are best-effort.
Shared-device users should clear site data after use. A server-side password reset
revokes access but cannot remotely erase offline browser data. There is no WORM guarantee, automated Office import,
automated account deletion/export, or zero-downtime/distributed recovery.
