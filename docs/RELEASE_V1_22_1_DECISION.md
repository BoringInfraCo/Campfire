# v1.22.1 release decision — ONB-001 First-Run Handoff (scoped patch)

**Date:** October 18, 2026

**Status:** Founder-directed release, recorded under the founder delivery rule in `docs/ROADMAP.md`. This document and the release-prep revision (`1.22.1` bump + tracked versioned installer) are committed here; the publication steps (private annotated tag, public snapshot, GitHub Release, channel pins, production deployment) are recorded in the promotion table as they complete and run only after the dated D6 addendum closes packaging in `docs/SPRINT_ONB_001_RESULT.md`.
**Package target:** `1.22.1`
**Contract:** `docs/Campfire-v1.22.1-ONB-001-First-Run-Handoff.md` (§5 build sequence, §6 D1–D6, §7 verdict rules)
**Sprint result:** `docs/SPRINT_ONB_001_RESULT.md` — as corrected (`4abbe2e`): D1–D5 passed, D6 packaging pending, human comprehension **NOT OBSERVED**. The release-prep revision closes D6 in the dated result addendum; nothing else in the result is rewritten.
**Candidate commits:** Step 0 freeze `54f6389`; implementation `1e68373`; result record `f8adb3c`; result correction `4abbe2e`.

## Founder direction and sequencing

On October 18, 2026 the founder, acting in the `Campfire-Internal` repository, directed the v1.22.1 release, verbatim:

> "lets get ready to commit/push/release v1.22.1 do not mention in the publix release notes that no humans have tried it!"

The founder also endorsed the recorded gate assessment that defines the sequencing this decision follows, verbatim:

> "The next step is **release prep**, not publication: commit the result correction, record the separate founder decision, prepare version 1.22.1 without changing the immutable 1.22.0 installer, then pass packaging and record a dated D6 addendum. Only then reassess the release gate."

This is that **separate, recorded founder release decision** for the `v1.22.1` bump, snapshot, installer pin, and deployment that contract §7 requires. The founder also directed that the public release notes describe the shipped behavior without restating the human-observation status; the human-outcome record stays in this document and in the sprint result (this mirrors prior releases: the v1.22.0 GitHub release notes also describe behavior, while the decision records carry the observation status).

This document is **not a human-outcome result and is not a verdict change**:

- ONB-001's cold human check remains **NOT OBSERVED** (this session had no eligible non-builder participants; the contract forbids substituting the builder, an agent, or a scripted capture). Nothing is rescored.
- With D6 closed by the dated addendum, contract §7 awards **CONDITIONAL GO — engineering candidate**: the tested truth and recovery rules hold as engineering evidence; no comprehension, continuation, or team-value result is claimed for any person.
- No check is loosened. The immutable-installer guard in `scripts/package.sh` stays, and the published `v1.22.0` installer copy is not modified.

## The exact release surface (nothing else)

The published v1.22.0 surface gains exactly the ONB-001 candidate (`1e68373`):

- **Truthful first-run receipts**: a fresh interactive `campfire` (and local `campfire up`) reports only detected and successfully prepared harnesses as `Config prepared — restart <Harness> to load Campfire tools` — a written MCP configuration block is never reported as connected, online, ready, or as a created workspace — and gives one next action: restart the named harness and describe the work so the agent can create the workspace and goal with you.
- **Bounded recovery truth**: `--no-connect` is labeled as connection setup deliberately skipped, not a detection failure; a returning profile with no workspace says so and names `campfire up` as the reopen step; a stored workspace selection is labeled local profile data and routes to current authorized work without claiming service or presence state.
- **Invitation boundary unchanged, wording clearer**: the join receipt distinguishes `Joined` (membership) from `Config prepared` (harness configuration) and never tells an unprepared harness to reload; invalid, expired, used, or wrong-endpoint invitations still fail with the existing recovery; no invitation secret or token appears in any receipt.
- **Read-only no-workspace Viewer state**: the empty Viewer names a truthful next action (no workspace to show yet; after reloading a configured agent, describe the work so the agent can create the workspace and goal) and stays read-only, actor-bound, and escaped; a joined remote profile (`data-workspace-hint="joined"`) is not told to create a local workspace.
- **Two entry paths in docs**: installer, `campfire --help`, README, and the operator docs present local `campfire` (which does not create a workspace) and invitation-file `campfire join` on a fresh or isolated recipient profile before recommending a command; `onboard` remains the one-shot scripted alternative. The stale "connects each installed Codex or OpenCode as an agent" wording is gone from source, docs, installer, and README.
- **Versioned installer for this release**: `public/campfire/v1.22.1/install.sh` is tracked from the current installer (sha256 `2256bccb086d3c83e9a997de46285e5ad5175bb3f696a6641322b16ccba8a844`). The published `public/campfire/v1.22.0/install.sh` copy is immutable and byte-identical to the released one (sha256 `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`, unchanged from the v1.22.0 promotion record).
- **No protocol change**: no CLI command, CLI JSON shape, piped/non-TTY behavior, MCP method, HTTP route, database schema, migration, telemetry event, Viewer read method, or Viewer write path changed.

## Evidence status in this release

| Evidence | Status in this release |
| --- | --- |
| D1 — fresh local truth; D2 — absent/skipped/returning; D3 — invitation boundary; D4 — Viewer and source parity; D5 — credentials and JSON | **Engineering PASS** on `1e68373`, recorded in `docs/SPRINT_ONB_001_RESULT.md` §2 (PTY frames and served-Viewer evidence under `docs/evidence/onb-001/candidate/`; harness detection simulated with marker directories — labeled, never human evidence) |
| D6 — release hygiene | **Closed by the dated addendum** in `docs/SPRINT_ONB_001_RESULT.md` after the release-prep revision passes `pack:tarball` and the fresh verification battery (typecheck, full suite, build with public-copy parity, `deploy:dry-run`), with the expected pre-pin install-channel assertion named and not loosened |
| Expected pre-pin install-channel assertion | `tests/unit/install-channels.test.ts` pins `packaging/homebrew/campfire.rb` and `flake.nix` to the published archives; they remain at v1.22.0 until the post-publication pin commit (`node scripts/sync-install-channels.mjs` against the four published v1.22.1 checksums), so the assertion fails exactly as pre-recorded for v1.22.0 — named here, closed by the pin, **not weakened** |
| Human comprehension of the first-run receipts | **NOT OBSERVED** (unchanged). Later observations record under their own date, per the contract §7. |
| Gate B/C/E/F; WCO-001, ARH-001, ATT-001, SWH-001, UIX-001; NAV-001 §6; VIS-001 condition 4 | **Unchanged/unobserved.** This release satisfies none of them and moves none. |

## Public release notes (v1.22.1)

Used verbatim for the GitHub Release body:

```markdown
Campfire v1.22.1 — Truthful First-Run Receipts

The first-run and join flows now say exactly what was prepared and what still needs a harness reload, instead of implying an agent is already connected.

- A fresh interactive `campfire` run (and local `campfire up`) reports each detected harness as `Config prepared — restart <Harness> to load Campfire tools`: writing MCP configuration is never reported as connected, online, ready, or as a created workspace, and the receipt gives one next action — restart the named harness and describe the work you want to do, so your agent can create a Campfire workspace and goal with you.
- `--no-connect` is labeled as connection setup deliberately skipped, not a detection failure. A returning profile with no workspace says `No workspace yet` and names `campfire up` as the reopen step; a stored workspace selection is labeled as local profile data and routes to your current authorized work without claiming service or agent-presence state.
- The read-only no-workspace Viewer shows a truthful empty state — there is no workspace to show yet; after reloading a configured agent, describe the work so the agent can create the workspace and goal. The Viewer stays read-only and actor-bound, and a joined remote profile is not told to create a local workspace.
- The installer, `campfire --help`, README, and the operator docs now present the two entry paths before recommending a command: starting locally with `campfire` (which does not create a workspace), or joining a teammate's existing work with `campfire join --invitation-file <private-file> ...` on a fresh or isolated recipient profile. `onboard` remains the one-shot scripted alternative.
- After a successful join, the receipt distinguishes `Joined` (workspace membership) from `Config prepared` (harness configuration) and directs you to run `campfire up` and reload the named harness. Invalid, expired, or used invitations still fail with the existing recovery.

No CLI command, JSON output shape, MCP method, HTTP route, database schema, migration, telemetry event, or Viewer read method changed, and piped output stays machine-readable.

Darwin and Linux archives for ARM64 and x64, with SHA-256 checksum files, are produced by the release workflow after publication. The versioned installer at `campfire/v1.22.1/install.sh` pins to this version.
```

## What users should know

- Campfire still cannot reload or approve anything inside your harness: it writes supported MCP configuration, and you restart the harness (and approve Campfire tools if asked) yourself.
- Workspace membership and harness configuration are different facts, and the receipts now say which one happened: `Joined` means you are a member; `Config prepared` means the harness configuration was written and a reload is still needed.
- The join path stays recipient-owned on a fresh or isolated profile; an initialized local profile is never covertly merged into an invited workspace.
- The upgrade from v1.22.0 is the same install path; the versioned installer at `campfire/v1.22.1/install.sh` pins this release, and the published v1.22.0 installer copy is unchanged.
- No object, schema, migration, notification, or write path is added.

## Promotion record

Each step is recorded with its evidence as it completes; no check is loosened. Publication steps below start only after the dated D6 addendum in `docs/SPRINT_ONB_001_RESULT.md` closes packaging on this release-prep revision. The private-repository CI install-channel assertion is expected to fail until the post-release pin commit (pre-recorded as the expected failure, not a defect).

| Step | Evidence |
| --- | --- |
| Founder direction, result correction, and release-prep revision | This document and the decision/prep commit on `main`: `package.json`/`package-lock.json` at `1.22.1`; tracked `public/campfire/v1.22.1/install.sh` (sha256 `2256bccb086d3c83e9a997de46285e5ad5175bb3f696a6641322b16ccba8a844`, byte-identical to the current installer); `public/campfire/v1.22.0/install.sh` verified untouched (sha256 `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`); result correction committed as `4abbe2e`. Darwin ARM64 `pack:tarball` exit 0: `release/campfire-darwin-arm64.tar.gz` sha256 `f5ca9d307b12ba7ef657ff2fb80f17ca6f0d5c74ada728216b31df9bf16a70c0`, extracted package `1.22.1`. Fresh verification battery at this revision recorded in the dated D6 addendum. |
| Private annotated `v1.22.1` tag | Pending publication. |
| Audited public source snapshot | Pending publication. |
| Public GitHub Release and four checked archives | Pending publication. |
| Homebrew / Nix pins, tap promotion, installer checks | Pending publication (pin via `node scripts/sync-install-channels.mjs` against the four published checksums). |
| Production Worker deployment and live verification | Pending publication. |
