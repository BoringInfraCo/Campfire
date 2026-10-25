# SHR-001 production publication — October 25, 2026

**Status:** Fresh production publication and branded link recorded. The physical
second-Mac acceptance is **NOT OBSERVED**.

This record closes part of SHR-001's production hosted claim. REL-001 is the
CONDITIONAL GO in `docs/RELEASE_V1_26_2_DECISION.md`. CLO-001 stays PARTIAL.
The physical iMac acceptance is not proven here.

## Pin and artifact

| Fact | Value |
| --- | --- |
| Earlier pin | `ffbb30b7c4b8ceeaaf69ec87e3ddcf8504141e71` |
| Earlier archive | `/tmp/campfire-1.26.2-pin/release/campfire-darwin-arm64.tar.gz` |
| Earlier SHA-256 | `7087e5c44e7acbb447b8b9017025370bd15260247b29804402f455e919cd3caa` |
| Note parent | `5b7c254774dbb428e52ee156a3c47cb4a6969faf` (still says "no public tag or release") |
| Stale note archive | SHA-256 `c0347b2d797115614189f0ba1d15e40a699e9d2e10147462c386b36fb93a421d` — do not publish |
| Package | `1.26.2`, `campfire.releaseStatus = "candidate"` |
| Local verification archive | `Campfire-Internal/release/campfire-darwin-arm64.tar.gz` |
| Local verification SHA-256 | `523054058c2a62f7f0e8168349e841e0adb4b1a947e4539bce1d391dd54c2a75` |
| Archive `releaseNote` | Controlled Cloud alpha. CLI accept/decline. No browser click-to-accept. No open signup. |
| Published Darwin ARM64 | `e97f8c3d3af3cad350769265b2fdfdefa4b733b4fde54ffa84c6bddc56c900e7` |
| Published Darwin x64 | `9d24897b3eae166aebdd3e3931e6010b5db6bfe0dbc9a9f87c294c0c7ccbbbcf` |
| Published Linux ARM64 | `d859d1b2d490cf36930ca458d9c2920212fe89ee071bb2acf1417932bce4f675` |
| Published Linux x64 | `67d8acc483ddbda13c987aeef1b51b1b2118c7ad19db05f52d4eadef708d3ae1` |

The archive differs from the earlier `0d2c2de` candidate
(`269aac014c39037e037a41b50bc77f9e202cc7c8f0ace7de9c4dd61ed6c8fcbc`): the
later limiter, recovery, and alpha-budget source is present in this rebuild.

## Production service

| Fact | Value |
| --- | --- |
| Worker | `campfire` |
| Current version | `f8e4f3f9-d178-4957-a2c3-76b24d4be43f` (2026-10-25T13:17:04Z) |
| Prior version | `48a620de-4dbc-4f9d-9b93-85e9599b13ce` |
| D1 | production `campfire` database, size 503,808 bytes |
| Migrations | `0010_workspace_publication.sql`, `0011_alpha_usage.sql` applied |
| Invitation limiter | `INVITATION_RATE_LIMITER`, 30 requests / 60 s |
| Admission | `CAMPFIRE_PUBLICATION_ALPHA = "1"`; operator code hash secret set |
| Expensive writes | `CAMPFIRE_ALPHA_EXPENSIVE_WRITES = "0"` (paused 2026-10-25; publication alpha remains `"1"`) |
| Join page | `https://boringinfra.company/campfire/join` → HTTP 200 |

Admission is operator-gated, not open signup. `POST
/campfire/v1/publication/enroll` without a code returns HTTP 403 `A rehearsal
admission code is required`.

The operator-held code is stored mode `0600` outside the repository at
`~/campfire-production/admission.env`. It is not recorded here.

## Fresh workspace

| Fact | Value |
| --- | --- |
| Local source workspace | `ws_4c51ce5e3ad24a6e` — "Production Alpha Verification" |
| Local source tip | 7 contributions; 1 finding, 1 task, 1 goal |
| Publication id | `pub_5007a990ad4a36778003bb24a0b0b184` |
| Hosted workspace | `ws_c5687463e8624498` — "Production Alpha Launch Verification" |
| Hosted created | 2026-10-25T12:13:24.562Z |
| D1 rows | 2 enrollments, 1 publication |

This is a **fresh** workspace. Arbora (`ws_df6794f33efc459b`) was not copied or
moved, and the rehearsal link was not rewritten.

## Branded link and second profile

The issued link begins:

```text
https://boringinfra.company/campfire/join#v1.…
```

The capability is stored mode `0600` at
`~/campfire-production/production-invitation.link`; it is not printed here.
`~/campfire-production/production-invitation-accept.link` is the second
profile's acceptance copy.

A second local profile (`~/.config/campfire-prod-alpha-v2`) reports:

```json
{"kind":"workspace_status","state":"ready","workspace":{"id":"ws_c5687463e8624498","name":"Production Alpha Launch Verification"}}
```

**This is a same-machine second profile, not the physical iMac two-Mac test.**
It shows the branded link can be previewed and accepted, and that the accepted
profile reads the hosted workspace. It does not prove the plan's physical
MacBook → hosted → iMac → MacBook acceptance, and it does not prove a read/write
with the origin Mac's service stopped on a second machine.

## Not proven

- Physical iMac acceptance of the branded link.
- A read and write from the second Mac while the origin Mac's local service is
  stopped.
- Per-team CPU, a 5% invitation ratio, and D1 growth above 256 KiB. The seven
  notification policies in `docs/evidence/shr-001/clo-001/README.md` are active.
- There is still no configured SSH host for the iMac, so the physical run
  cannot be started from this MacBook.

## Rollback

```bash
# Restore the prior Worker version
npx wrangler rollback 48a620de-4dbc-4f9d-9b93-85e9599b13ce --name campfire

# Or redeploy the prior version explicitly. Then:
npx wrangler secret delete CAMPFIRE_PUBLICATION_REHEARSAL_CODE_HASH --name campfire
# and set CAMPFIRE_PUBLICATION_ALPHA back to "0" through the deploy path.
```
