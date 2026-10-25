# v1.26.2 release decision — CONDITIONAL GO

**Date:** October 25, 2026  
**Decision:** **CONDITIONAL GO** — tag, push, and publish public Campfire
`v1.26.2`. The founder authorized this on October 25, 2026 after the
notification policies were created and tested. The physical iMac acceptance
is still not observed. Open signup is not enabled.  
**Release target:** Public Campfire download with a controlled Cloud alpha for
admitted users; no open signup.

This record is the REL-001 founder decision. It follows
`docs/RELEASE_V1_26_2_READINESS_REVIEW.md` and the Phase 1 exit in
`docs/Campfire-Native-Continuity-Alpha-Sprint-Plan.md`.

## What the evidence supports

- Product source remains `ffbb30b7c4b8ceeaaf69ec87e3ddcf8504141e71` plus the
  `package.json` `releaseNote`. `5b7c254774dbb428e52ee156a3c47cb4a6969faf`
  still says "no public tag or release" and is not the published note.
  Package `1.26.2`, `releaseStatus` `candidate`.
- The local Darwin ARM64 verification archive is
  `release/campfire-darwin-arm64.tar.gz`, SHA-256
  `523054058c2a62f7f0e8168349e841e0adb4b1a947e4539bce1d391dd54c2a75`.
  Its `lib/campfire/package.json` `releaseNote` is the controlled-alpha
  sentence and does not deny a public release. Do not publish
  `c0347b2d797115614189f0ba1d15e40a699e9d2e10147462c386b36fb93a421d`
  (`5b7c254`) or `7087e5c44e7acbb447b8b9017025370bd15260247b29804402f455e919cd3caa`
  (`ffbb30b`). The full suite (132 files / 1,580 pass, 1 skip) was run on
  `ffbb30b`, not re-run for the note edit.
- The installed candidate reports 1.26.2 and exposes the CLI invitation-link
  preview/accept/decline flow. The released 1.26.1 binary does not.
- Local first-run works without a Cloud account.
- Focused SHR/CLO tests pass (21 files / 129 tests). The full suite result
  above is the `ffbb30b` run.
- A fresh production workspace was published to
  `https://boringinfra.company/campfire` (`ws_c5687463e8624498`), the branded
  link begins `https://boringinfra.company/campfire/join#v1.…`, and a
  same-machine second profile accepted it and reads the hosted workspace.
- Production admission is operator-gated by code; open signup is not enabled.

## Conditions on this GO

1. **The physical iMac acceptance is not observed.** A second-Mac read/write
   while the origin Mac's local service is stopped has not been run. The
   same-machine second profile is not that test. There is no SSH host for the
   iMac.
2. **Three alert signals stay outside Cloudflare Notifications.** Per-team CPU
   above 5 CPU-seconds, a 5% invitation ratio, and D1 growth above 256 KiB
   have no matching alert type. The seven policies in
   `docs/evidence/shr-001/clo-001/README.md` are active, and each test call
   returned success.
3. **Expensive writes are paused.** Live Worker
   `f8e4f3f9-d178-4957-a2c3-76b24d4be43f` has
   `CAMPFIRE_ALPHA_EXPENSIVE_WRITES` `"0"` and `CAMPFIRE_PUBLICATION_ALPHA`
   `"1"`. Committed `wrangler.toml` keeps both at `"0"`. Do not deploy that
   file over production.

## Publication

Published October 25, 2026. Private annotated tag `v1.26.2` is
`5d86bbc1de124d674e86e60a03aae730edc98278`. The public snapshot is
`bf126294e3f32c2d384da3588b7b6638b73af44d` on `BoringInfraCo/Campfire`, parent
`e12e52b`. The GitHub Release is
https://github.com/BoringInfraCo/Campfire/releases/tag/v1.26.2. Public CI
`40229954192` passed. Release workflow `40229970842` passed and attached the
archives. Each downloaded checksum matched its archive, and each extracted
package reports `1.26.2` / `candidate` with the controlled-alpha note.

| Archive | SHA-256 |
| --- | --- |
| Darwin ARM64 | `e97f8c3d3af3cad350769265b2fdfdefa4b733b4fde54ffa84c6bddc56c900e7` |
| Darwin x64 | `9d24897b3eae166aebdd3e3931e6010b5db6bfe0dbc9a9f87c294c0c7ccbbbcf` |
| Linux ARM64 | `d859d1b2d490cf36930ca458d9c2920212fe89ee071bb2acf1417932bce4f675` |
| Linux x64 | `67d8acc483ddbda13c987aeef1b51b1b2118c7ad19db05f52d4eadef708d3ae1` |

The local SHA-256 above is the pre-CI Darwin ARM64 check only. Do not publish
it. `releaseStatus` stays `candidate`. This channel-pin commit points
Homebrew and Nix at these four published archives. The v1.26.2 tag does
not move. The release is a controlled Cloud
alpha: CLI accept or decline, no browser click-to-accept, and no open signup.
MAC-002 may use the released artifact. This decision does not deploy the
Worker.
