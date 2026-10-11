# Flux product requirements

## Identity

Collaborate live. Explore alternatives. Keep the story.

Flux combines shared work with safe experimentation and contextual review:
**create → collaborate → checkpoint → branch → discuss → approve → merge**.
Target users are college teams, startups, research groups, and small teams.

## Delivery boundaries

### Document-focused MVP

- Authentication, private workspaces, invitations, and server-enforced roles.
- Collaborative documents, presence, durable saving, and reconnection.
- Persistent text chat.
- Immutable checkpoints, read-only history, and restore-as-new-revision.
- Experiments from main checkpoints with independent collaboration rooms.
- Stable-block three-way comparison, visible conflicts, explicit resolutions.
- Approval against exact source/target revisions and resolved result.
- Safe merge into the authoritative live state and an immutable resulting checkpoint.
- Basic manually created Decision Bookmarks.

The current implementation includes the initial foundation/document slice and
checkpoints/read-only history/restore. Branching, review, merging, chat, and
Decision Bookmarks are still future work; this is not the completed MVP or V1.

### Full V1

- Anchored comments and richer contextual discussions.
- Voice, video, screen sharing, and Live Merge Rooms via LiveKit.
- Tested spreadsheet and presentation integrations through an existing editor.
- File-level Office snapshots and documented import/export limitations.

### Later

- Fine-grained replay supported by deliberately retained updates/events.
- Advanced Office-format semantic merging.
- Explicit cross-file references and consistency alerts.
- Nested branches, repeated merges, and more sophisticated branch graphs.

## Non-goals

No AI chatbot, social feed, automatic call recording, custom Office engine,
silent conflict resolution, or promised perfect Office-format compatibility.

## Roles

| Role | Edit | Branch | Review | Finalize approved merge | Manage members |
|---|---|---|---|---|---|
| Owner | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | No | No | No |
| Reviewer | No | No | Yes | Yes | No |
| Viewer | No | No | No | No | No |

Future review/branch permissions are defined in the shared policy, but their
features/endpoints do not exist yet. First-slice invitations assign Editor,
Reviewer, or Viewer; role reassignment and ownership transfer are deferred.

## History invariants

- Historical states are read-only.
- Restore appends a revision rather than erasing subsequent work.
- Checkpoints include schema version and immutable content references.
- Server-generated events are separate from content synchronization.
- Do not imply that CRDT updates provide perfect human authorship.

## Merge invariants

- Compare base, reviewed main, and reviewed experiment.
- Preserve changes made only on main.
- Propose changes made only on the experiment.
- Conflicting edits, edit/delete conflicts, ambiguous ordering, and unsupported
  structures require explicit resolution.
- Any source/target changes invalidate the initial approval in the MVP.
- Serialize finalization against live document writes; no snapshot replacement
  under connected clients and no last-writer-wins REST overwrite.
- Archive the experiment after merging in the MVP.

## Decision invariants

Bookmarks record title, explanation, creator/time, file/branch, checkpoint,
content anchor, discussion, and status. A deleted anchor is marked unavailable;
the bookmark is retained and must not attach itself to unrelated content.

## Release gates

Reliable document collaboration and safe merging take priority over expanding
formats. Calls do not record by default. Office integration viability is decided
by a licensing and capabilities proof of concept, not by assumptions.
