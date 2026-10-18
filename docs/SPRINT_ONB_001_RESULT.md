# Campfire — Sprint ONB-001 Result: First-Run Handoff

**Date:** October 18, 2026

**Status:** **D1–D5 passed; D6 packaging pending; human comprehension NOT OBSERVED.** This is not CONDITIONAL GO. Contract §7 awards that verdict only when D1–D6 pass, and D6 requires `pack:tarball` to pass. No version bump, tag, public snapshot, installer pin, release decision, or deployment is part of this result. A `v1.22.1` bump, tag, snapshot, channel pin, or deployment requires a separate recorded founder release decision. This record does not claim human comprehension, Gate B/C/E/F, or closure of NAV-001, WCO-001, ARH-001, ATT-001, SWH-001, UIX-001, or VIS-001.

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
