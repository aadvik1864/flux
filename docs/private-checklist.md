# Personal-use acceptance record

Copy this into your private operator notes. These are practical checks for your
own low-risk documents and a few trusted invitees, not a public-launch audit.
Do not put credentials, backup keys, bearer links, or personal data in this file.
Setup commands and limitations are in `private-access.md`.

## Your choices

- Tested release commit/image tag:
- Host OS/resources, expected users/devices, and sleep/startup behavior:
- Private-network access rules and trusted client certificate setup:
- SMTP/sender provider (no credentials):
- Backup storage and independent key/config recovery location (references only):
- Acceptable data loss and time to recover; actual backup/restore timings:

## Before relying on it

| Check | Evidence/date |
| --- | --- |
| Second device reaches HTTPS/WSS over the VPN without certificate warnings; outside-VPN access is denied | Pending |
| Real invitation, verification, password reset, and session revocation work | Pending |
| Two accounts co-edit; viewer cannot write; review/merge and Decision Bookmark context work | Pending |
| Acknowledged **Saved** content survives restart; browser draft recovery is understood | Pending |
| Encrypted backup has a verified second copy and recoverable off-machine keys, or local-only loss risk is explicitly accepted | Pending |
| Isolated empty-target restore preserves document/history/decisions, revokes old access, and refuses a populated target | Pending |
| Timers run when expected; readiness/disk/backup status is visible; any configured notification actually arrives | Pending |
| Needed browsers/devices work; invited friends know how to request a manual export/removal and what backup/browser retention means | Pending |
| Dependency audit and image scan reviewed for the chosen release; license obligations understood | Pending |

Local fixtures support these checks but do not fill them in for your actual host.
No Kubernetes, paid integration, enterprise monitoring, or external audit is
required for this limited personal experiment. Do not mark the broader public
launch gates passed. Revisit `launch-checklist.md` before broader/sensitive use.

## Decision

- Accepted limitations and unresolved issues:
- Ready for this limited use, or defer (owner/date):
