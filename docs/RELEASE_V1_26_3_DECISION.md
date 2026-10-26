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

Package `1.26.3`, `releaseStatus` `candidate`. The source tag kept the
Homebrew formula and Nix flake on the published v1.26.2 archives. This
channel-pin commit moves those channels to the published v1.26.3 archives
and does not move the tag.

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

- Private tag `v1.26.3` is `f60cf689ff230dd914a3be0d2ae21ce753d782dd`. The tag does not move.
- Public snapshot `af87f28d4197516c06cbb205d4c02a0eba0706df` on `BoringInfraCo/Campfire`.
- GitHub Release https://github.com/BoringInfraCo/Campfire/releases/tag/v1.26.3
- Release workflow `40255075192` succeeded and attached the four archives. Public CI `40255074695` and `40255072852` succeeded.
- Darwin ARM64 `5e2520ad19a330bdcffd136f9b3e1365689e026e4bb26967312e4b28414b7f2c`
- Darwin x64 `81fbfab43732913bc420a586599ac6aa234b700c2bc368d7215fc77966224ba1`
- Linux ARM64 `f32e35fcdf9bf1b537648751b31f2ed894e579e24eaab4d144ce9d7f8f1e13c7`
- Linux x64 `274b34172a8f3a231d16ec49d1db0bb12003c9ab9d2767005869f997d1b7d37e`

`releaseStatus` stays `candidate`. This channel-pin commit points Homebrew and Nix at these four published archives. The v1.26.3 tag does not move. The Worker is not deployed.
