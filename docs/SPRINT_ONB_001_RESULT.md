# Campfire — Sprint ONB-001 Result: First-Run Handoff

**Date:** October 18, 2026

**Status:** **D1–D5 passed; D6 closed by the dated §D6 addendum below — CONDITIONAL GO — engineering candidate; human comprehension NOT OBSERVED.** Before that addendum this record read "D1–D5 passed; D6 packaging pending; not CONDITIONAL GO" (correction commit `4abbe2e`). The v1.22.1 release-prep revision (`b1ba31c`) and the founder release decision (`docs/RELEASE_V1_22_1_DECISION.md`) are separate from this sprint result. No tag, public snapshot, channel pin, or deployment is part of this record; a v1.22.1 publication requires that separate recorded founder release decision. This record does not claim human comprehension, Gate B/C/E/F, or closure of NAV-001, WCO-001, ARH-001, ATT-001, SWH-001, UIX-001, or VIS-001.

**Contract:** `docs/Campfire-v1.22.1-ONB-001-First-Run-Handoff.md`
**Baseline:** published `v1.22.0` — tag object `83d0602`, commit `1b9432d`, package `1.22.0`. Frozen in `docs/evidence/onb-001/`.
**Candidate:** `1e6837305fc00f735282bb6def60fdd917e5ae07` on `main`. Package version remains `1.22.0`.
**Evidence:** `docs/evidence/onb-001/candidate/` — masked PTY frames and the served-Viewer fetch note.

## 0. Verdict and what it does not claim

Contract §7 **CONDITIONAL GO — engineering candidate** applies only when D1–D6 pass and the pre-registered cold human check is unavailable for a recorded reason. D6 did not pass, so this record does not award that verdict.

- **Recorded reason the human check is open:** this session had no eligible non-builder participants, and §7 forbids substituting the builder, an agent, or a scripted capture. Human comprehension is **NOT OBSERVED**.
- The frames in `docs/evidence/onb-001/candidate/` are engineering evidence. Harness detection was simulated with marker directories.
- **D6 packaging pending:** `npm run pack:tarball` wrote `release/campfire-darwin-arm64.tar.gz` (sha256 `c132028c193dc637680612be97f3a057aa8d77671f8f8cc1e2e55c7ca6e1d253`) and then exited 1. `scripts/package.sh` refused to overwrite `public/campfire/v1.22.0/install.sh` because the current installer differs from that published copy. The guard did the right thing. The published v1.22.0 pin was not changed, and the guard was not weakened. This is a release-readiness gap. D6 closes only in a dated addendum, after a separately approved `v1.22.1` release-prep revision passes `pack:tarball`.
- Live invitation exchange, a config-preparation failure, a returning profile that already has a workspace, and a served joined-remote Viewer were not driven in the PTY pass. The receipt tests and `enrollment-cli.test.ts` cover the join wording and the invitation boundary. Remote `up` and remote `view` pass `workspaceHint: "joined"`.

## 1. What is in the tree

**Step 0 freeze (`54f6389`):** the contract and the published v1.22.0 first-run baseline packet.

**Product change (`1e68373`):**

- `src/presentation/receipts.ts` — one pure vocabulary for local `up`, returning status, the awaiting-workspace next step, join, and remote `up`. A written MCP block is "Config prepared — restart <Name> to load Campfire tools". It does not say the harness is connected, online, or ready, and it does not claim a workspace was created.
- CLI status, help, README, `docs/OPERATOR.md`, and the public-release operator override distinguish local `campfire` from invitation-file `campfire join` on a fresh or isolated profile. `onboard` stays the scripted alternative.
- The current installer states the join path before the local path, and says the local path does not create a workspace. Published `public/campfire/v*/install.sh` copies were not edited.
- The no-workspace Viewer says there is no workspace to show yet. A local shell may say the agent can create the workspace and goal. A joined shell (`data-workspace-hint="joined"`) says it does not create a local workspace. The Viewer stays read-only.
- Piped catalog commands stay JSON. Bare `campfire` stays human unless JSON is explicit. `up` JSON keeps the v1.22.0 keys.

## 2. Deterministic checks

Run on `1e68373` (macOS, Node v22.23.2, vitest 5.0.0), by an independent read-only pass after the candidate commit.

| Check | Result |
| --- | --- |
| **D1 — fresh local truth** | PASS. PTY fresh `campfire` asked only for the name, started `up` once, printed Viewer `http://127.0.0.1:[port]`, and named only the prepared harnesses with a restart instruction. Both-harness and Codex-only runs passed. No live-agent, registered-session, or created-workspace claim. |
| **D2 — absent, skipped, returning** | PASS for the runs that were driven: no harness, `--no-connect`, and a returning no-workspace profile (retried, identical). `--no-connect` is labeled skipped, not a detection failure. Config-write failure and a returning workspace selection were not driven live; the receipt tests cover those states. |
| **D3 — invitation boundary** | PASS, bounded. No live invitation exchange. Join receipt tests distinguish `Joined` from `Config prepared` and do not tell an unprepared harness to reload. `enrollment-cli.test.ts` passed in the full suite. Invitation checks were not weakened. |
| **D4 — Viewer and source parity** | PASS for the served local empty Viewer: `data-workspace-hint="local"`, both empty sentences present in served `app.js`, no "Waiting for an agent to start work." `src/viewer/static/` matches `public/` for `app.js`, `app.css`, `index.html`, and `campfire-mark.svg`. A joined Viewer was not served. |
| **D5 — credentials and JSON** | PASS. Frames and the served Viewer contain no `cft_` token. Piped `up --no-open` matches `A9-up-json-no-open.stdout.txt` after port masking (same keys, no added keys). Piped `status` matches `C5-return-no-workspace-status-json.stdout.txt` after id masking. `--output human` on a pipe stays a human receipt. |
| **D6 — release hygiene** | **PENDING.** `npm test` exit 0 (97 files, 1213 passed, 1 skipped: the opt-in dashboard screenshot). `npm run build` exit 0. `npm run deploy:dry-run` exit 0. Real terminal frames and a served empty Viewer were captured. The stale "connects each installed Codex or OpenCode as an agent" sentence is gone from source, operator docs, the current installer, and README. `npm run pack:tarball` exited 1 at the immutable `v1.22.0` installer check after the archive was written, so D6 does not pass. The published pin stays. Close D6 in a dated addendum when a separately approved `v1.22.1` release-prep revision passes `pack:tarball`. |

The awaiting-workspace machine field `next[0].when` is still `Start the local API and Viewer so an agent can connect`. That string is part of the frozen status JSON and was left in place so the piped status document stays byte-compatible. The human receipt adds a separate next paragraph that does not claim a harness is connected.

## 3. Human outcome

**NOT OBSERVED.** No cold non-builder participants ran the local scenario and the invitation scenario.

---

## D6 addendum — release-prep revision (October 18, 2026)

The founder recorded the v1.22.1 release decision in `docs/RELEASE_V1_22_1_DECISION.md` (commit `b1ba31c`): commit the result correction, record the separate founder decision, prepare version `1.22.1` without changing the immutable `1.22.0` installer, pass packaging, close D6 in a dated addendum, and only then reassess the release gate. This addendum does that; it rewrites nothing above.

**Release-prep revision:** `b1ba31c` — `package.json`/`package-lock.json` at `1.22.1`; `public/campfire/v1.22.1/install.sh` tracked from the current installer (sha256 `2256bccb086d3c83e9a997de46285e5ad5175bb3f696a6641322b16ccba8a844`); the published `public/campfire/v1.22.0/install.sh` verified byte-unchanged (sha256 `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`, the v1.22.0 promotion value); the `scripts/package.sh` immutable-installer guard was not weakened.

**Verification battery at `b1ba31c`** (macOS, fresh serial runs by an independent verifier):

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS (exit 0). |
| `npm test` | 97 files — 96 passed, 1 failed; 1,214 tests — 1,212 passed, 1 failed, 1 skipped (the opt-in dashboard screenshot). The one failure is the pre-recorded install-channel assertion: `tests/unit/install-channels.test.ts:31:21` expects `packaging/homebrew/campfire.rb` to contain `/v1.22.1/` while the formula and `flake.nix` remain pinned to the published v1.22.0 archives. Named here, **not loosened**; it goes green with the post-publication pin commit (`node scripts/sync-install-channels.mjs` against the four published v1.22.1 checksums), exactly as in v1.22.0. |
| `npm run build` | PASS (exit 0); `src/viewer/static/` byte-identical to `public/` for `index.html`, `app.css`, `app.js`, and `campfire-mark.svg`. |
| `npm run deploy:dry-run` | PASS (exit 0; wrangler 4.149.0; Total Upload 345.91 KiB / gzip 65.62 KiB). |
| `npm run pack:tarball` | **PASS (exit 0).** `release/campfire-darwin-arm64.tar.gz` written with a matching `.sha256` sidecar; the verification run's archive sha256 is `d68c7e2dbdb53d9c76ef6af0f27c07d9543b91a195e924e783fcec92883cd4c2` (the earlier prep-run archive hashed `f5ca9d307b12ba7ef657ff2fb80f17ca6f0d5c74ada728216b31df9bf16a70c0`; local archives embed tar timestamps, so per-run digests differ — the pinned digests come from the CI-built published archives, as in every prior release). Extracted `lib/campfire/package.json` reports `1.22.1`. After the run, `public/campfire/v1.22.1/install.sh` still matches the current installer and `public/campfire/v1.22.0/install.sh` still matches the published copy. |

**Effect:** with `pack:tarball` passing on the release-prep revision and the published v1.22.0 pin intact, **D6 closes as of this dated addendum**. Contract §7 now awards the **CONDITIONAL GO — engineering candidate** verdict: D1–D6 pass, and the pre-registered cold human check remains unavailable for the recorded reason (no eligible non-builder participants; §7 forbids substituting the builder, an agent, or a scripted capture). Human comprehension stays **NOT OBSERVED**. The §2 table above is left as the historical pre-addendum state; this addendum, not a table edit, is the closure.

**Publication status:** as of this addendum no tag, public snapshot, GitHub Release, channel pin, or deployment exists for v1.22.1. The export/public-copy audit runs at publication from the tagged release source per the release-mirror workflow. Publication steps follow the release-gate reassessment and are recorded in `docs/RELEASE_V1_22_1_DECISION.md`'s promotion table as they complete. Completed October 18–19, 2026: v1.22.1 was published and deployed; the full record is the promotion table in `docs/RELEASE_V1_22_1_DECISION.md`.
