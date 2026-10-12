# Free/self-hosted integration gates

Evidence checked **2026-10-12**. No hosted subscription, paid license, or public
deployment has been selected. A working local prototype does not establish
capacity, device support, license suitability, or production integration.

## Calls: LiveKit local feasibility passed

The server and JavaScript SDKs use Apache-2.0:
[server license](https://github.com/livekit/livekit/blob/v1.13.9/LICENSE),
[client](https://github.com/livekit/client-sdk-js),
[server SDK](https://github.com/livekit/server-sdk-js).
[Self-hosting documentation](https://docs.livekit.io/transport/self-hosting/)
confirms that the open-source server can run on owned infrastructure. There is no
required cloud account or paid service in this fixture; hosting/bandwidth are not free.

`npm run test:livekit` runs unmodified LiveKit **1.13.9** with client **2.22.4**
and server SDK **2.19.1** in a disposable Docker network. Server/browser images
are pinned by digest. It publishes no host ports, uses generated private keys,
mounts no Docker socket or host media devices into the browser, and removes only
its randomly named containers/network. Evidence stays in private `/tmp/opencode`
storage; keys and tokens are never committed.

Verified locally:

- Two independently tokened browser contexts join an explicitly created room.
- Both receive microphone/camera RTP bytes from the other, using fake input devices.
- Browser-native screen capture publishes and the other client receives its packets.
  This is automated Chromium capture, not real hardware/user-picker coverage.
- An invalid signing secret cannot join.
- With automatic room creation disabled, deleting the old room disconnects both
  participants. An **unexpired** old-room token cannot recreate it; a newly
  authorized identity joins the explicitly created next-epoch room.

This is **not a Flux call feature**: there are no workspace call controls,
application token endpoints, call membership records, moderation, or deployment
media ports. The prototype establishes a possible revocation primitive, not a
complete authorization protocol. Before integrating:

1. Bind grants to current verified sessions/workspace membership, exact room
   epoch, and unique participant-session identities; use minimal publish grants.
2. Serialize room creation/retirement and token issuance under durable application
   state. Disable automatic creation; never recreate retired epochs. Offboarding,
   logout/password reset, and expiry must disconnect relevant participants and
   prevent rejoining with cached tokens. Short token TTL alone is insufficient.
3. Reconcile server API failures/restarts, bound room/participant quotas, and fail
   closed when authorization cannot be checked. Do not leak room names or tokens
   in logs. Add independent-account and tenant/revocation acceptance tests.
4. Provide opt-in microphone/camera/screen controls, clear join/leave/error states,
   accessible layouts, device cleanup, and reconnect behavior. No recording by default.
5. Validate HTTPS/WSS, UDP/TCP ICE/TURN across real networks and firewalls, target
   resource usage, mobile/Safari/Firefox, privacy disclosures, and image scans.
   Do not assume the current web gateway's 80/443-only firewall is sufficient.
6. Keep calls optional and isolated from document persistence/merge correctness.

Local evidence: `/tmp/opencode/flux-livekit-s7od6cyp/evidence.json`;
that path is machine-local supporting evidence, not a portable release dependency.

## Office: not approved under the current constraints

### Univer

The [collaboration guide](https://docs.univer.ai/guides/sheets/features/collaboration)
and [server license guide](https://docs.univer.ai/server/license) describe licensed
collaborative features and browser license configuration. An open-source core is
not evidence that the required collaboration/import-export/server features have
a perpetual free license covering Flux. No qualifying license was obtained.
**Do not select paid/pro packages or assume trial access meets the free requirement.**

### ONLYOFFICE Community

The [edition comparison](https://www.onlyoffice.com/compare-editions.aspx) lists
Community as free under AGPLv3 and recommends up to 20 users; Enterprise and
Developer are commercial editions. The current
[DocumentServer license](https://github.com/ONLYOFFICE/DocumentServer/blob/master/LICENSE)
adds attribution/legal-notice/trademark and non-code CC BY-SA terms. Review the
license of the exact chosen release and its components, not just the main-branch label.

AGPL is not a blanket prohibition on private software, nor automatic permission
for every proposed integration. The scope of source-offer, combined-work,
distribution, and UI-notice obligations must be established for Flux's intended
packaging/hosting. No legal suitability conclusion or permission to publish Flux
source/change branding has been inferred. No commercial edition is authorized.

No Office service was added to the Docker kit and no spreadsheet/presentation
co-editing, callback security, restart persistence, import/export fidelity, or
snapshot prototype has passed. See [the evaluation checklist](office-evaluation.md).
Consider other genuinely self-hostable/free candidates in a separate review;
do not present an untested alternative as an approved replacement.
