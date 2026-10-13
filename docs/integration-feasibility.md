# Future integration constraints

Calls and Office editing are outside the document MVP and public showcase.
Integrations must be self-hostable without a paid subscription; hosting resources
and license obligations still apply. The license review below was made on
2026-10-12 and must be repeated for the exact release selected later.

## Calls

[LiveKit](https://github.com/livekit/livekit) is an Apache-2.0 candidate with
[self-hosting support](https://docs.livekit.io/transport/self-hosting/).
A local fake-device experiment established two-client media/screen transport,
signature rejection, and room retirement with automatic creation disabled.
That unused fixture and its SDK dependencies were removed from the document
codebase; it was never a Flux call feature or real-device acceptance.

Before integration:

- Bind grants to verified sessions, current workspace membership, exact room
  epochs, and unique participant sessions. Use minimal publish permissions.
- Serialize creation/retirement and token issuance in durable application state.
  Logout, reset, expiry, and offboarding must disconnect participants and prevent
  cached-token rejoin. Short token expiry alone is insufficient.
- Reconcile server failures, bound quotas, fail closed on authorization errors,
  and keep room names/tokens out of logs.
- Provide explicit join/leave and device controls; recording is off by default.
- Test real devices, HTTPS/WSS, external ICE/TURN, firewalls, browser support,
  privacy, and capacity. Keep calls isolated from document persistence.

## Office editing

Neither candidate is approved:

- **Univer:** its [collaboration](https://docs.univer.ai/guides/sheets/features/collaboration)
  and [server license](https://docs.univer.ai/server/license) guides describe
  licensed features. An open-source core does not establish a perpetual free
  license for the required collaboration/import-export/server functionality.
- **ONLYOFFICE Community:** the [edition comparison](https://www.onlyoffice.com/compare-editions.aspx)
  lists a free AGPLv3 edition. The [DocumentServer license](https://github.com/ONLYOFFICE/DocumentServer/blob/master/LICENSE)
  includes attribution/legal-notice/trademark and non-code CC BY-SA terms.
  Source-offer, combined-work, distribution, and UI obligations need review for
  Flux's intended packaging. No permission to publish source or change branding
  follows from the edition label alone.

Selection requires a suitable license, two-account spreadsheet/presentation
co-editing, workspace authorization, authenticated replay-resistant save callbacks,
restart persistence, private file snapshots, representative XLSX/PPTX round-trips,
and measured host capacity. Trials or commercial editions do not meet the current
free/self-hosted requirement. No Office service or accepted prototype exists;
semantic merging and perfect format fidelity are not promised.
