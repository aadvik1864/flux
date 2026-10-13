# Roadmap

## Implemented

- Accounts, private workspaces, invitations, roles, and active revocation.
- Collaborative rich-text documents, live cursors, and durable saving.
- Named checkpoints, read-only history, and fenced restore as a new revision.
- Isolated experiments, conservative three-way comparison, explicit conflicts,
  exact-head non-author approval, and incremental reviewed merges.
- Persistent discussions and Decision Bookmarks tied to original checkpoint
  context; deleted or recreated anchors remain unavailable.
- Browser draft recovery, outage retry, responsive themes, and keyboard navigation.
- Invite-only Docker deployment, verified email, encrypted SMTP outbox, and
  encrypted backup/empty-target restore.
- Personal private-network setup and opt-in backup/maintenance/health timers.
- Account-free read-only showcase with a separate frontend-only HTTPS deployment.

Validation coverage and its limits are in [testing](testing-plan.md).

## Next: publish the showcase

- Choose the public host/hostname and verify trusted HTTPS from outside the VPN.
- Review dependency/image findings and bundled licenses.
- Check all sample views on a real phone and desktop before sharing the link.

See [showcase setup](showcase.md). No public deployment has been made.

## Before using the full app

Configure real SMTP, access rules, monitoring, off-host backups, and independent
key custody. Test restoration on the intended hardware and record the acceptable
data-loss/downtime window. Personal acceptance is in [private-checklist.md](private-checklist.md);
broader use needs [launch-checklist.md](launch-checklist.md), sustained load/device
checks, privacy/deletion/export procedures, and an independent security review.

## Future product work

- Calls, screen sharing, and Live Merge Rooms with Flux authorization/revocation
  and real network/device acceptance.
- Spreadsheets/presentations only after licensing and co-editing/import-export
  suitability are established. See [integration constraints](integration-feasibility.md).
- Richer anchored comments, fine-grained replay, nested experiments, and cross-file
  references as separate milestones.

Local document acceptance is not completed Full V1 or a security certification.
