# Public read-only showcase

The showcase lets anyone explore Flux without an account. It uses fictional
content: a garden plan, an isolated experiment, its reviewed result, a discussion,
a Decision Bookmark, and saved checkpoints. Visitors can switch views and themes;
they cannot edit, approve, merge, restore, or save documents.

Deploy the showcase on Vercel or with the standalone Next.js/Caddy kit. Neither
needs a database, collaboration process, SMTP service, or connection to your real
workspace. Both serve `/demo` and its assets, redirect `/` to `/demo`, reject write
methods, and return 404 for login, API, document, and synchronization routes.
Session cookies are neither forwarded nor set. The browser stores only its theme
preference; sample navigation resets on reload.

The full app still supports `/demo` as a public page and links to it from sign-in.
That does not make real workspace routes public. Use Vercel's showcase-only mode
or the separate showcase Compose file when publishing the demonstration.

## Preview locally

No Docker, database, account, or SMTP setup is needed for this preview:

```bash
npm ci
npm run dev:showcase
```

Open `http://127.0.0.1:3000/demo`. The frontend server must remain running. Other
application routes need the full local stack; they are not part of this preview.

## Vercel

Use a Hobby project for this personal, non-commercial showcase. No database,
storage add-on, SMTP credentials, or custom domain purchase is required.

Import the private repository into a **new** Vercel project with:

- Framework: **Next.js**; Root Directory: **apps/web**.
- Include source files outside the Root Directory: **enabled**.
- Node.js: **22.x**; standard/basic build resources.
- Vercel Authentication: **preview deployments only**, so production is public.
- Preview/production feedback toolbars: **off**.

`apps/web/vercel.json` builds only the shared/editor packages and web app. On
Vercel, the application automatically enforces the read-only allowlist, strips
account credentials, and disables API rewrites. Deployment source/logs stay
private (`public: false`); the public demo does not make GitHub public.
Image optimization is disabled in showcase builds, and Vercel routing explicitly
blocks its native optimizer before platform handling. The illustrations are
already WebP assets.
Do not copy `.env` or `.flux-private` into project environment settings.
`.vercelignore` excludes secrets, local configuration, backups, and build/test
artifacts from CLI uploads.

For CLI deployment, authenticate locally and link from the **repository root**:

```bash
npx vercel login
npx vercel link --yes --project flux-showcase --scope YOUR_HOBBY_SCOPE
npx vercel --prod --scope YOUR_HOBBY_SCOPE
```

The `.vercel.app` production URL should work without signing in. Check it with
normal certificate validation (no fixture TLS exception):

```bash
FLUX_SHOWCASE_URL=https://YOUR_PROJECT.vercel.app FLUX_SHOWCASE_BOUNDARY_TEST=true npm run test:showcase
```

To test the same boundary on a local production server, set
`FLUX_SHOWCASE_ONLY=true` for **both** build and startup. Ordinary development
previews still retain the full app's routes. Vercel is not the deployment for the
long-running collaboration server or your real workspace.

## Self-hosted Docker

Use an existing Linux Docker host and a DNS hostname you control. A free hostname
from an existing host/DNS provider is fine; no paid integration is required. The
host must accept public TCP 80/443 for Caddy's certificate issuance and HTTPS.
Keep SSH restricted and do not expose container port 3000. If publishing from a
home machine, decide how to handle router forwarding, sleep, and address changes;
the kit does not change your network settings for you.

```bash
cp deploy/showcase.env.example deploy/showcase.env
nano deploy/showcase.env
```

Set `FLUX_DOMAIN` to a hostname, not a URL, and `ACME_EMAIL` to your real operator
email. Set a unique `FLUX_TAG`, for example `showcase-<release-commit>`. Check public
A/AAAA records against the chosen host; remove an incorrect IPv6 record rather
than leaving some visitors pointed at another machine.

```bash
docker compose --env-file deploy/showcase.env -f deploy/compose.showcase.yaml build
docker compose --env-file deploy/showcase.env -f deploy/compose.showcase.yaml up -d --wait --no-build
```

Use this standalone file, **not** `compose.prod.yaml` or the private overlay. It
does not need production credentials. Do not add the API/database services to it
or attach it to the private application's Docker network. Keep its Compose project
name distinct from the full application so their services and networks stay separate.

Caddy obtains a publicly trusted certificate automatically once DNS and inbound
access work. Visitors should not need a VPN, a custom CA, or certificate-warning
exceptions. This is a Node deployment, not a static export for GitHub Pages.

Before sharing the URL, check from a device outside your home/VPN:

- `/` opens the demo over trusted HTTPS; fonts, artwork, and both themes load.
- All five views work on desktop and a real phone.
- `/login`, `/api/auth/me`, `/sync`, and `/files/example` return 404.
- `POST /demo` returns 405 with `Allow: GET, HEAD`.
- There are no account forms, editable fields, or live-workspace data.

The service is disposable: the sample is versioned source, not a database to back
up. Keep the chosen source/images and the Caddy volumes for normal certificate
renewal. For an update, choose a new release tag and rebuild; do not overwrite an
old tag that you may need for rollback. Stop it without deleting certificate
volumes using the same Compose command followed by `stop`.

## Tests and boundaries

```bash
npm run test:showcase
npm run test:release:showcase
```

The first command covers Chromium and Firefox, keyboard use, day/night persistence,
320px layouts, no-JavaScript document reading, and absence of API/sync requests.
The Docker exercise additionally checks frontend-only service composition,
hostname-verified TLS, production CSP, route denial, and rejected write methods.
It uses loopback and a disposable test CA, not real public DNS/ACME evidence.

Local tests do not establish public reachability. Verify the chosen production
URL before sharing it. The demo shows a prepared example,
not live co-editing or completed calls/Office integration. Publishing still needs
a dependency/image review and compliance with the third-party licenses listed in
`ui-sources.md`; required credits must stay in place.
