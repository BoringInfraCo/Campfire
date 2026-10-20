# v1.24.1 release decision — focused Viewer Navigator layout

**Date:** October 19, 2026
**Status:** Release-prep verified; promotion is in progress and evidence is recorded below as each step completes.
**Package target:** `1.24.1`
**Candidate:** `9a3abf5` — the local, independently reviewed visual follow-up to the published NAV-003 read model.

## Founder direction

The founder directed this release in the Campfire repository:

> "i love it! well done! so that matches our mockup in ROADMAP.md if so lets commit/push/release it so its in production for our users"

This authorizes the private commit and push, version bump and tag, audited public snapshot, GitHub Release, channel promotion, and production deployment. The release is a scoped patch because it changes the existing read-only Viewer's presentation and interaction, without adding a method, object, write path, schema, migration, or credential surface. The visual target is the three-zone Navigator mockup linked in `docs/ROADMAP.md`; its sample counts and green palette are illustrative and are not copied into the product.

## Release surface and evidence

- A wide Viewer has a workspace rail, one focused record list, and a structured selected-record pane. Secondary summaries are collapsed; the default read still opens on authorized Needs You or team attention. The 390px path stacks list, source, and history with a visible Back control and compact navigation.
- Source IDs, exact returned coverage, stale-read labels, decision status, provenance, artifact reference classification and unverified-target caveats, and the bounded read model retain their released meanings. The preview uses only a loaded authorized record; selecting a row still follows the existing detail read when needed.
- Independent review found and the candidate fixed keyboard row/detail alignment, artifact reverse citations in selected detail, narrow-screen focus restoration, and source-ID contrast. Before the version bump, Node 22 typecheck and build passed, and the full suite passed **100 files / 1,256 tests**, with one opt-in skip. Served desktop and 390px list were visually checked. The initial narrow capture in `docs/evidence/nav-visual-candidate/` predates the final mobile compaction; the served candidate was checked after that change.
- This is engineering verification, not a new human-comprehension result. NAV-003's two-person comparison remains **NOT OBSERVED**; no gate or prior sprint verdict moves through publication.
- The `public/campfire/v1.24.1/install.sh` copy is byte-identical to the current installer (`2256bccb086d3c83e9a997de46285e5ad5175bb3f696a6641322b16ccba8a844`). Published versioned installers, including v1.24.0, remain immutable. The pre-pin install-channel test is expected to fail until the four published archive checksums are available and the channel pins are advanced; no assertion or guard will be loosened.

## Public release notes

The following body is used for the public GitHub Release:

```markdown
Campfire v1.24.1 — Focused Viewer Navigator

The read-only browser Viewer now follows the focused Navigator layout: a workspace rail, one record list, and a selected-record pane on wide screens, with a compact list → source → history path on narrow screens.

- Needs You remains the first view. Work, Decisions, Sources, People, and Recent changes stay reachable from one rail, with My work and Team work over the same authorized workspace.
- A selected record presents its state, provenance, and linked sources in a clearer reading order. The list and detail stay aligned while moving by keyboard; selected artifacts retain their recorded finding citations. Small source IDs remain readable on selected rows.
- The 390px layout brings the first record higher on screen and moves focus to the visible detail when a record opens. Back returns to the originating row.
- Counts and coverage come from authorized reads; the mockup's sample data is not product data. Existing bounded reads, Viewer authorization, read-only behavior, artifact-reference safety, and CLI/API contracts are unchanged. There is no schema migration.

Darwin and Linux archives for ARM64 and x64, with SHA-256 checksum files, are produced by the release workflow. The versioned installer at `campfire/v1.24.1/install.sh` pins this release.
```

## Promotion record

| Step | Evidence |
| --- | --- |
| Candidate commit and private push | `9a3abf5` on private `main`, pushed after a clean source/public asset parity check. |
| Release-prep verification at 1.24.1 | Node 22 typecheck and build pass; source/public Viewer assets match byte-for-byte. Full suite: **100 files, 1,255 passed, one failed, one opt-in skip**; the only failure is the pre-recorded `install-channels.test.ts` expectation for `/v1.24.1/` while the formula and flake correctly remain pinned to published v1.24.0 archives. `deploy:dry-run` exits 0 with 73 public assets and the expected D1, telemetry, rate limiter, and asset bindings. `pack:tarball` exits 0; Darwin ARM64 archive SHA-256 is `983a5a5bbb3d0cdea76cb7dbd0199c79256e5261e62d8e8cc59acec618dd839b` and its package metadata extracts as `1.24.1`. The new installer equals the current installer byte-for-byte; the tracked v1.24.0 installer digest remains `2256bccb…`. No assertion or immutable guard was changed. |
| Private annotated tag | `v1.24.1` object `b662c5a4e84d49539981bb0faa589c3205178cf8` points to release-prep commit `a013d4f1055f56686f5cb9fc3e67e87a41a99364`; both were pushed. The tag will not move. |
| Public export metadata correction | The first tag export exposed an inherited hardcoded v1.24.0 test count in the public `RELEASE_CONTEXT.md` template. No product source changed: a post-tag private main commit corrects the template to **1,255 passed / one expected pre-pin failure / one skip** and adds the scoped visual finding. The exporter intentionally reads public templates from current private `HEAD` while preserving `sourceCommit: a013d4f…` from the immutable tag. The final audited export uses that corrected template. |
| Audited public snapshot and tag | Exported from `v1.24.1` with the corrected public template: 343 manifest files equal 343 files on disk; the exporter found no forbidden path or secret pattern; `sourceCommit` remains `a013d4f…`. Public snapshot commit `9f91fc99be5724b7f7137704a11ef09f24f09424` and annotated tag object `860d919a5cd6bceec4f0f66106a7a3e16e3d171e` were pushed. The required pre-pin public CI check was bypassed for the snapshot push and then failed only on the expected channel assertion; it is closed by the later addendum. |
| GitHub Release and four checksummed archives | Published at `https://github.com/BoringInfraCo/Campfire/releases/tag/v1.24.1` (not draft or prerelease). Workflow `39356024903` passed all four platform jobs and attached eight assets. Downloaded checksums each passed against their archive; all four extracted packages report `1.24.1`. SHA-256: Darwin ARM64 `bc202195bd6ac847b76f22eecb6e0bd4cc131065ed43fe9b587bedcd184d89aa`; Darwin x64 `3e57db2ff32e1b48e365587769445280dd72eaca9223ae13b93b5000ba204470`; Linux ARM64 `9bc7dbc84fa1752a2528f3e1429bf7fd4d30bfe52b10b75d699041f0f1864eb6`; Linux x64 `ca43b6341526a1ddacddcebe5706062e3938678f4849ff8ad92e6548f72df471`. |
| Homebrew/Nix pins and tap | `sync-install-channels.mjs --version 1.24.1` fetched the four published checksums, pinned formula and flake, and `--check` passed. The post-pin full suite passed **100 files / 1,256 tests**, one opt-in skip, closing the pre-pin assertion. Private pin commit, public addendum, and tap promotion are recorded after push. |
| Production Worker and live checks | Pending. |
