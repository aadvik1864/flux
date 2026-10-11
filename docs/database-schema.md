# Initial database schema

The source of truth is `apps/api/prisma/schema.prisma` and its checked-in migrations.

| Model | Key relationships / guarantees |
|---|---|
| User | Unique normalized email; salted password hash; optional verified-email timestamp |
| Session | Hashed random token; user; expiry |
| AccountToken | Hashed one-use verification/reset token; purpose/user/expiry; user-row serialized consumption |
| SignupInvitation | Operator-issued email-bound hashed signup credential; expiry and atomic claim |
| EmailMessage | AES-GCM encrypted delivery payload; attempts/backoff; erased after SMTP delivery |
| AuthThrottle | Hashed address/operation throttle key; atomic fixed-window hit count |
| SecurityEvent | Credential/invitation/recovery event type and optional user ID; no email/token/password |
| Workspace | Private team boundary |
| WorkspaceMember | Composite workspace/user key; role |
| Invitation | Unique hashed token; workspace; matching email; role; expiry; consumption time |
| File | Workspace; name; unique optional main branch reference |
| Branch | File; unique name; room generation; monotonic checkpoint number |
| DocumentState | Full mutable recovery state; generation and accepted-update revision |
| Checkpoint | Immutable S3 reference/checksum; schema; source revision; server author/time; restore links; idempotency request |
| ActivityEvent | Server-generated workspace/file checkpoint and restore events |

File and its initial branch are created in one transaction. Invitation claim and
membership creation run in one transaction; conditional claiming prevents two
requests from independently consuming the same invitation.

DocumentState is not history. Checkpoint rows reference private immutable objects.
Restore appends preserved/current checkpoint rows and updates generation/recovery
state in one transaction; no earlier checkpoint row is updated. Subsequent
migrations will add audit events, chat, branches/reviews, and decisions.
