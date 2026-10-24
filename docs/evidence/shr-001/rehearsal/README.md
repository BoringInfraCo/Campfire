# SHR-001 isolated rehearsal evidence

**Date:** October 24, 2026  
**Status:** Prepared; physical two-Mac run **NOT OBSERVED**  
**Candidate record:** `docs/RELEASE_V1_26_2_CANDIDATE.md`

## Target

| Fact | Value |
| --- | --- |
| Candidate | `1.26.2` (unreleased) |
| Source commit | `1fa4e4d11f29629cd65a57e7ab6f2162c846783b` |
| Archive checksum | `ad3d74c134042e641467109db9689edeacdc72479242d921dd8566ee279e19c9` |
| Worker | `campfire-shr001-rehearsal` |
| Endpoint | `https://campfire-shr001-rehearsal.sunbeam-redraft-7j.workers.dev` |
| Worker version | `0d552dd5-4c6f-443d-80ab-b6eadbe01b04` |
| D1 | `campfire_shr001_rehearsal` (id in gitignored config) |
| Migrations | 10 applied through `0010_workspace_publication.sql` |
| Route | none; `workers.dev` only |
| Assets binding | omitted (API-only) |

## Remote gate matrix

| Probe | Result |
| --- | --- |
| Alpha `0` enroll/import/recover | `403` |
| Alpha `1`, admission hash unset | `403` admission not configured |
| Alpha `1`, hash set, no code | `403` code required |
| Alpha `1`, hash set, wrong code | `403` code rejected |
| Alpha `1`, hash set, correct code, invalid body | `400` validation; no enrollment rows |
| `/v1/call` no bearer | `401` |
| `/` | `404` |
| Production Worker version | unchanged `785c8415-5d58-4cd9-9a57-97aef22b78ad` |

D1 after the gate probe: `publication_enrollments = 0`; admission attempts = 4.
The raw rehearsal code is stored only in the private mode-0600 file
`~/campfire-rehearsal/v1.26.2/rehearsal.env`; the Worker stores only its SHA-256.

## MacBook candidate

- Archive: `~/campfire-rehearsal/v1.26.2/artifacts/campfire-1.26.2-darwin-arm64.tar.gz`
- Extracted binary: `~/campfire-rehearsal/v1.26.2/install/bin/campfire`
- Package reports `1.26.2` / `candidate`.
- Pinned profile: `CAMPFIRE_CONFIG_DIR=$HOME/.config/campfire-arbora`
- `campfire status --output json` selected `ws_df6794f33efc459b`.
- `campfire up --no-open` smoke served `127.0.0.1:9414`; no session was
  registered by starting it. It was stopped after the smoke.

The stale default `~/.config/campfire` Ada profile was not used. The released
`~/.local/bin/campfire` (`1.26.1`) was not overwritten.

## Not claimed

No physical MacBook → hosted → iMac → fresh MacBook run; no hosted Arbora copy;
no public tag, GitHub Release, channel update, or production deployment.
