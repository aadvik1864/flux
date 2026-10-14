# Live Flux hosting

The live frontend is the separate `tls124/flux-live` Vercel project with root
directory `apps/web`. Set `FLUX_DEPLOYMENT_MODE=live`, `APP_ORIGIN` to its stable
production HTTPS URL, `API_INTERNAL_URL` to the Render backend URL plus `/api`,
and `NEXT_PUBLIC_COLLABORATION_URL` to the backend's WSS URL plus `/sync`.
Showcase deployments keep their default restrictions; explicitly setting
`FLUX_SHOWCASE_ONLY=true` always takes precedence.

The backend runs the existing API, mail worker and exactly one collaboration
process behind `deploy/live-runtime.mjs` on one free Render web instance. HTTP
traffic is accepted only under `/api/`, WebSocket upgrades only on `/sync`,
and readiness checks on `/ready`. Internal collaboration commands remain
reachable only on loopback. Production configuration must validate before
migrations or services start. The process shuts down both children on failure.

Use the separate `flux-live-postgres` Neon database's direct, non-pooled URL
as `DATABASE_URL`: the collaboration process holds a session advisory lock.
Provider-generated Neon passwords are accepted with at least 16 characters
only for `.neon.tech` hosts with `sslmode=require`; other credentials retain
the original minimum of 32 characters.

Set `SNAPSHOT_STORAGE=vercel-blob` and use the private
`flux-live-checkpoints` store's `BLOB_READ_WRITE_TOKEN`. Checkpoints retain
immutable stable paths, the 8 MiB size limit and SHA-256 integrity checks.
The existing S3 adapter remains the default for existing installations.
The existing Docker backup scripts are S3-specific: do not use them with
the Blob deployment. Back up the Neon database and private Blob objects
together through their provider tooling before relying on this workspace.

Production access remains invite-only with verified email. Configure Brevo
SMTP on port 2525 with STARTTLS, authenticated credentials, a verified
sender, and an independently generated mail encryption key. Once SMTP is
verified, create the initial operator invitation with the existing operations
command. Do not put passwords or bearer invitation links in logs.

Free Render services may sleep after 15 minutes without HTTP or WebSocket
traffic and take about a minute to wake; their 750 monthly hours are shared
with the account's other free services. Neon and Blob have usage quotas.
This deployment is suitable for a small personal workspace subject to those
limits; initial cold starts may require retrying the login page.
