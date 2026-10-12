# Operator launch evidence

Copy this record to private operator storage; do not commit credentials, bearer
links, personal data, or server-access details. Until each gate has evidence and an
owner's approval, the document MVP is **not cleared for live use**.
See `docs/production.md` for commands and limitations.

## Release record

- Release commit and immutable image tags/digests:
- Staging/target hardware and expected concurrent editors:
- Operator, incident contact, and approval date:
- Planned maintenance window, backup RPO, and recovery RTO:
- Secure location of configuration and backup keys (reference only):

## Required evidence

| Gate | Evidence to record | Status / owner / date |
| --- | --- | --- |
| Domain and network | A/AAAA checks; firewall exposes only 80/443 and restricted SSH; trusted public HTTPS and WSS from outside the host | Pending |
| Email ownership and recovery | SPF/DKIM/DMARC results; actual inbox invitation, verification, reset; single-use links; old session revoked | Pending |
| Secrets | Independent random values; no example secrets; off-host config/key custody; restore operator can access required keys | Pending |
| Alerts | Independent uptime/disk/error/backup alerts; force staging SMTP rejection, observe quarantine/webhook and readiness failure, retry or acknowledge, confirm recovery | Pending |
| Backups | Verified off-host upload; isolated empty-target restore; document/checkpoint/discussion/decision content, permissions, revoked sessions/approvals, and generation fencing checked; populated target refusal | Pending |
| Team load | Sustained expected-team editing, rapid paste/deletes/tables, network interruption, server restart, storage growth; measured latency/memory and no false Saved or lost acknowledged work | Pending |
| Browser recovery | Offline edit → browser backup → close/reopen → read-only review → explicit resume; restore old generation → download-only; full/unavailable storage warning; shared-device logout cleanup | Pending |
| Review and decisions | Independent reviewer; retained main-only changes; conflict and stale-head refusal; offboarded approvals stay superseded; archived experiment/drafts stay read-only; deleted anchors retain original context | Pending |
| Devices and accessibility | Agreed Chromium/Firefox versions; Safari/WebKit and real touch devices if needed; keyboard focus, 320px layout, day/night, reduced motion | Pending |
| Privacy and support | Policy/contact, account deletion/export procedure, server/backup/browser-draft retention, shared-device guidance | Pending |
| Security and licensing | Independent review; pinned-image vulnerability scan; dependency audit; React Bits Commons Clause and GSAP license suitability approved | Pending |

Local release tests prove only disposable Docker/TLS/SMTP fixtures on the test
machine. They do not prove DNS/ACME issuance, real-world inbox delivery, sustained
target capacity, external alert routing, or legal suitability. Attach local test
results as supporting evidence, not substitutes for the gates above.

## Go / no-go

- Unresolved failures and accepted risks:
- Rollback/forward-fix plan after migration:
- Backup and restore exercise reference:
- Final operator approval (or reason to defer):
