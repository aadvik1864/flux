# Personal project: private remote access

Run Flux on an existing **Linux machine with Docker Engine**, and reach it over
your private VPN. No public hosting, purchased domain, port forwarding, or paid
integration is required. The machine, Docker, and VPN must stay running. Windows
sleep or stopping WSL also stops availability if Linux runs inside WSL.

This is the document MVP, not integrated calls/Office editing. Start with your own
non-sensitive documents and a few trusted invited people. A private VPN reduces
exposure; it does not replace verified accounts, HTTPS, or recoverable backups.

## What the private kit changes

- `deploy/compose.private.yaml` overlays the existing production kit. It replaces
  the public 80/443 mappings with **one port on an explicit private IP** (8443 by
  default). Unconfigured binding falls back only to loopback, never `0.0.0.0`.
- `deploy/Caddyfile.private` uses Caddy's private CA. There is no public ACME
  request, HTTP redirect port, Tailscale Serve/Funnel, or extra HTTP proxy hop.
  WSS, CSP, internal-route denial, and application permission checks are retained.
- `deploy/private.py` manages a separate project, protected configuration,
  preflight checks, encrypted backups, and optional user timers. It does not
  modify VPN enrollment, sharing, ACLs, firewall rules, or your other services.
- Invite-only signup, verified email, TLS-authenticated SMTP, and singleton API/
  collaboration processes remain mandatory. Use SMTP access you already have;
  do not run a mail server merely for this project.

Use the helper rather than starting `compose.prod.yaml` alone: that file still
describes the **public** kit. Do not add a tunnel/CDN/Serve proxy without reviewing
the application's one-proxy trust boundary. Restrict VPN access to your own
devices/trusted users, and verify reachability from a second device and denial
from outside the VPN. A private address alone does not establish those boundaries.

## 1. Initialize once

Requirements: Python 3.12+, Docker with Compose 2.24.4+, OpenSSL, and a working
private VPN. The helper deliberately selects Docker's local `default` context;
unrelated `DOCKER_HOST`, Compose, and application environment overrides are not
inherited. It is not a remote-Docker or rootless-Docker deployment tool.

From the repository root:

```bash
python3 deploy/private.py init
```

If Tailscale is already running, initialization reads this machine's VPN DNS
hostname and IPv4 address. It does not log in, change the tailnet, or enable a
public endpoint. For another private VPN, supply both values:

```bash
python3 deploy/private.py init \
  --hostname YOUR_PRIVATE_DNS_HOSTNAME \
  --bind-ip YOUR_VPN_IP
```

Initialization creates `.flux-private/` with mode 700:

| File | Purpose |
| --- | --- |
| `runtime.env` | Private origin/IP/port, unique image tag, independent application secrets, SMTP fields |
| `backup.key` | Independently generated 64-hex-character backup encryption key |
| `operations.json` | Backup target, local-only acknowledgement, optional alert webhook |

Files have mode 600. Initialization refuses to overwrite an existing directory.
The directory is excluded from Git, Docker build contexts, and frozen release
fixtures. Do not relocate secrets into another folder inside the checkout.
`--directory /ABSOLUTE/PRIVATE/PATH` is supported before the command for external
state storage; use the same option for subsequent commands.

This creates a **separate empty private project**; it neither copies nor deletes
the local development database, documents, or demo accounts. Existing development
accounts do not become verified production accounts automatically.

## 2. Fill your SMTP settings locally

```bash
nano .flux-private/runtime.env
```

Fill `MAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD`, then set:

- STARTTLS: `SMTP_PORT=587`, `SMTP_SECURE=false`; or
- implicit TLS: `SMTP_PORT=465`, `SMTP_SECURE=true`.

Use your provider's actual settings. Quote passwords according to Compose `.env`
syntax (single quotes preserve literal `$` and `#`). Do not paste credentials into
chat, commit them, print the resolved Compose configuration, or capture them in
diagnostic screenshots. Do not replace the generated secrets with example values.
`ACME_EMAIL` is unused by private Caddy and may keep its generated value.

Use a provider-verified sender. If using your own sender domain, follow its
SPF/DKIM/DMARC instructions. Successful SMTP authentication is not proof of inbox
delivery: test an actual invitation/reset after starting.

```bash
python3 deploy/private.py check
```

Preflight checks protected files, independent secrets, private binding, exactly
one published TLS port, the private Caddy configuration, and unchanged production
authentication. Missing SMTP configuration blocks startup; no insecure fallback
or example SMTP service is used.

## 3. Build and start

Record the tested source commit and keep `FLUX_TAG` unique. Build refuses to
overwrite existing image tags. To restart the same release, use `start` without
rebuilding; for another release choose a new tag first.

```bash
python3 deploy/private.py build
python3 deploy/private.py start
```

Startup checks that the VPN IP is actually assigned locally, initializes private
storage, applies migrations, checks SMTP TLS/authentication, and waits for service
health. It exports only the **public** CA certificate to `.flux-private/root-ca.crt`
and performs a hostname-verified HTTPS readiness check. No host trust store is
modified. If startup stops partway, inspect the failure and retry the same release;
never delete volumes to make an error disappear.

The origin is `APP_ORIGIN` in your protected environment file, normally
`https://YOUR_VPN_DNS_HOSTNAME:8443`. Only clients connected to the correct private
network should reach it. Do not forward 8443 from your router.

## 4. Trust the certificate on your own client devices

Private HTTPS needs a one-time client trust step. Transfer **only** `root-ca.crt`
to your own devices using a trusted method. Compare its SHA-256 fingerprint with
the original on your Flux machine before trusting it:

```bash
openssl x509 -in .flux-private/root-ca.crt -noout -fingerprint -sha256
```

Do not export Caddy's private CA key or copy `backup.key` to browsers. Never disable
certificate validation or routinely click through certificate warnings.

- **Ubuntu/Debian client:** copy the certificate to
  `/usr/local/share/ca-certificates/flux-private.crt`, then run
  `sudo update-ca-certificates`.
- **Windows client (including a browser outside WSL):** copy the public certificate
  into your Windows files, then run PowerShell:
  `Import-Certificate -FilePath "C:\PATH\root-ca.crt" -CertStoreLocation Cert:\CurrentUser\Root`.
- **macOS:** import the certificate into your Keychain and explicitly trust this
  certificate for SSL on your own device.
- **Firefox:** if the profile does not use the OS trust store, import it under
  Settings → Privacy & Security → Certificates → Authorities, permitting website
  identification.
- **Phone/tablet:** import the certificate using the device's certificate/profile
  settings; iOS also requires enabling full trust under Certificate Trust Settings.
  Confirm the browser recognizes it before signing in. Real mobile trust/network
  behavior still requires your device test.

Only trust a CA you control: installing a root CA gives it certificate-signing
authority on that device. Remove its trust entry when you retire this deployment.

## 5. Create your account and check the workflow

```bash
python3 deploy/private.py invite YOUR_EMAIL_ADDRESS
python3 deploy/private.py ready
```

Receive the invitation, verify your email, choose a password, and create a
workspace. Test password recovery, two independent accounts co-editing, viewer
denial, a reviewed experiment merge, and saved content surviving a restart.
Invite only addresses you trust. The experiment creator still needs a different
review-capable teammate to approve a merge; personal deployment does not remove
that correctness rule.

Mail diagnosis: `python3 deploy/private.py mail-status`. For quarantined mail,
use the explicitly confirmed resend/acknowledge procedures in `production.md`,
with the private environment **and both Compose files**. Never blindly resend
expired links or assume a restart resolves delivery failure.

## 6. Back up your documents

**First, keep the backup key and protected configuration securely recoverable
off this machine.** The encrypted archive does not contain them. Losing both the
machine and its only key copy makes the archive unusable.

For a first local test:

```bash
python3 deploy/private.py backup --local-only
```

This explicitly acknowledges that the encrypted copy does **not** protect against
losing the machine/disk. Backups briefly stop gateway/API/collaboration writers,
then resume services. Local archives go into `.flux-private/backups/`.

For a second copy, mount your own NAS/backup disk at a dedicated mount point,
using a POSIX filesystem that supports hard links/fsync and permits your user to
write. The helper does not mount, format, purchase, or provision storage:

```bash
python3 deploy/private.py backup-target /YOUR/MOUNT_POINT
python3 deploy/private.py backup
```

Registration verifies a separate mounted filesystem and writes a target identity
marker. Each backup verifies the replica checksum and refuses to overwrite an
archive. A missing/different/unmounted target fails before stopping writers rather
than falling back to local storage. If a target disconnects during export, the
local archive is retained and replica success is not recorded.

Separate storage is **not automatically off-host protection**: keep a disk copy
away from the machine, or use a genuinely remote NAS. Decide what risks you accept.
Archives are not automatically deleted; periodically review size/retention. Do
not keep the only decryption key beside the encrypted archives.

## 7. Enable optional automation

Generate templates without installing/enabling anything:

```bash
python3 deploy/private.py timers
```

After a manual verified backup, enable user timers:

```bash
python3 deploy/private.py timers --install
```

Without another storage target, you can explicitly accept weaker local-only
protection instead:

```bash
python3 deploy/private.py timers --install --allow-local-backups
```

Schedules use the host timezone: backup around 03:00, maintenance around 03:30,
and readiness/disk/backup-age checks every five minutes, with small random delays.
Jobs share a nonblocking lock with start/stop/manual operations. Checks defer during
normal backup downtime; a writer blocking checks over 30 minutes raises a failure
without killing it. Backups older than 30 hours or disk usage at least 85% fail
health. Direct SQL/storage writes or bypassing the helper are not covered by its
lock: do not overlap those operations with backups.

Health also refuses a missing recorded archive or disconnected replica mount. It
does not continuously rehash every archive; repeat restores to test recoverability.

```bash
systemctl --user list-timers 'flux-private-*'
journalctl --user -u flux-private-backup.service -n 50
journalctl --user -u flux-private-health.service -n 50
```

Without a webhook, results are **local journal/status files**, not delivered
notifications. To receive redacted failure/recovery notifications, set
`alert_webhook` in protected `operations.json` to your existing HTTPS JSON endpoint
and test it. Payloads contain only service, job, and status; TLS is checked and
redirects are refused. Alert delivery is best-effort, not a durable queue. These
host jobs cannot alert while the entire machine is off; use another device's
uptime check if that matters to you.

User timers require a running user manager. If needed, consciously enable
lingering with `sudo loginctl enable-linger "$USER"`. This does not prevent sleep,
turn on a powered-off machine, or arrange Windows/WSL startup. The helper does not
change those settings automatically. Existing unmanaged units or another private
instance's units are not overwritten.

To pause scheduling:

```bash
systemctl --user disable --now flux-private-backup.timer flux-private-maintenance.timer flux-private-health.timer
```

To stop Flux without deleting data: `python3 deploy/private.py stop`.

## Restore and upgrades

Rehearse restoration into a **new, empty private project**, using the release that
created the archive. Create separate protected recovery configuration outside the
checkout, set its VPN hostname/IP, distinct project/port, and provide its SMTP
settings. Keep the original backup key available. Do not run `start` or migrations
before the empty-target restore. You can use the same machine and VPN address with
port 8444, provided it has enough spare memory/storage; no second server is required.

```bash
python3 deploy/private.py --directory /SAFE/RECOVERY init \
  --hostname YOUR_VPN_DNS_HOSTNAME --bind-ip YOUR_VPN_IP \
  --project flux-private-recovery --port 8444
```

Fill the recovery SMTP settings and select the preserved matching-release image
tag in its `runtime.env`. If the images are not already available, build them from
that original source release before continuing. Do not change the live project's
configuration or volumes to rehearse recovery.

```bash
docker --context default compose \
  --env-file /SAFE/RECOVERY/runtime.env --project-name flux-private-recovery \
  -f deploy/compose.prod.yaml -f deploy/compose.private.yaml \
  up -d --wait postgres object-storage

read -rsp "Original backup key: " FLUX_BACKUP_KEY
export FLUX_BACKUP_KEY
python3 deploy/backup.py restore /PATH/TO/ARCHIVE.flux \
  --env-file /SAFE/RECOVERY/runtime.env --project flux-private-recovery \
  --docker-context default --compose-override deploy/compose.private.yaml \
  --confirm-empty
unset FLUX_BACKUP_KEY
```

The restore refuses existing tables/snapshots, revokes sessions/links and pending
approvals, and advances editing generations. Verify content/history/decisions and
permissions before reconnecting users. Put the original backup key in the recovery
directory's protected `backup.key` for future backups. A fresh Caddy volume issues
a **new private CA**; export it and update client trust rather than ignoring TLS
errors. Runtime settings, off-host custody, and Caddy's CA are not in the archive.

For upgrades, pause timers, take a verified backup, retain the old source/images,
choose a new image tag, and build. Stop the live application before applying
reviewed migrations/startup; this personal kit does not promise zero-downtime
upgrades. Do not blindly roll back old code after a schema migration or erase
populated volumes.

## Verification and limits

`npm run test:private` covers private binding, preserved authentication, secrets,
actual Compose resolution, writer locks, backup-copy failure/overwrite refusal,
redacted notifications, and safe timer generation. `npm run test:release:private`
exercises the private overlay using disposable loopback ports, trusted-CA HTTPS,
TLS SMTP, full document/review browser checks, the locked backup wrapper, and
empty-target restoration. It does not provision or certify your VPN, real inbox
delivery, mobile certificate trust, target storage, or wake-from-sleep behavior.

For this personal deployment, use a small practical go/no-go record: private access
and client trust work; real mail works; acknowledged documents survive restart;
you can restore; keys are recoverable; accepted storage/device limitations are
understood. If you later invite strangers, accept sensitive data, or commercialize
Flux, revisit `launch-checklist.md`, security/privacy procedures, capacity, and
third-party license suitability. Personal use is not a license exemption.

Copy `private-checklist.md` for that record. Dependency audit (`npm audit`) does
not scan operating-system packages in Docker images. Review an image scan for
the selected release with a free scanner such as Trivy before relying on it;
the helper does not install a scanner or claim that gate has passed.
