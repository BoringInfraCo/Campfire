# v1.26.3 release decision — CONDITIONAL GO

**Date:** October 25, 2026
**Decision:** **CONDITIONAL GO** — tag, push, and publish public Campfire
`v1.26.3`. The founder authorized commit, push, tag, and release on
October 25, 2026, and asked for Homebrew and Nix to match v1.26.3 after the
archives exist.
**Release target:** Public CLI download. Cloud sharing stays the v1.26.2
controlled alpha. Open signup stays closed. This decision does not deploy
the Worker.

## What this release is

UPD-001 adds a quiet stable-release notice, `campfire update`, and exact
`/update` in the dashboard. A direct install confirms the pinned version and
SHA-256 before replacement. Homebrew and Nix are not overwritten. A process
that started the local API or Viewer restarts only after `/health` reports
the new version. Any other service reports `restart required`.

Package `1.26.3`, `releaseStatus` `candidate`. The source tag keeps the
Homebrew formula and Nix flake on the published v1.26.2 archives. The pin
commit after release workflow checksums moves those channels to v1.26.3 and
does not move the tag.

## Conditions

1. **No Worker deployment.** Production admission and expensive-write settings
   stay as published for v1.26.2. Do not deploy `wrangler.toml` over
   production as part of this release.
2. **Open signup stays closed.** This patch does not change hosted sharing.
3. **Channel pins follow the archives.** Homebrew and Nix match v1.26.3 only
   after the four public archives and checksums exist. Do not invent
   checksums, and do not republish the v1.26.2 archives.
4. **A two-Mac update acceptance is not part of this evidence.** Focused
   UPD-001 tests cover notice, confirm, refusal, checksum, rollback, channel
   classification, owned restart, and `/health`.

## Publication

Record the private tag, public snapshot, GitHub Release, workflow run, and
archive checksums in this file after they exist. The local pre-CI archive is
not the published checksum.
