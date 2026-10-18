# ONB-001 Step 0 — baseline pin (published v1.22.0)

**Date:** October 18, 2026.
**Purpose:** freeze the published v1.22.0 first-run / return / join / Viewer
behavior as reproducible engineering evidence before any ONB-001 product code
changes. This packet is FIXTURE EVIDENCE — scripted captures of the shipped
CLI and Viewer. It is not a user study and not human-observation evidence.

## 1. Baseline identity

| Fact | Value |
| --- | --- |
| Private annotated tag | `v1.22.0`, tag object `83d0602ac43c801390f8001b5330c2c237814621` |
| Baseline commit (`1b9432d…`) | `1b9432dca9e2900bee2378e2672ca93df07200de` |
| Package version | `1.22.0` |
| Source HEAD when the packet was captured | `bf8d6ac9fd0fcc1314a864fc238148c1ff369a35` (`v1.22.0-2-gbf8d6ac`; the two later commits are the install-channel pin `971fe3d…` and the release record `bf8d6ac…`, neither changes `src/`) |
| `src/` comparison | `git diff v1.22.0 HEAD -- src` is empty; every capture tool re-verifies this before running |
| Capture interpreter | `tsx` from the baseline worktree's `node_modules/.bin`, `node` v22 |
| Baseline worktree | a detached v1.22.0 worktree in a short system temp root; never the developer's checkout |

Published-channel facts (recorded in full in `docs/RELEASE_V1_22_DECISION.md`):

| Artifact | Value |
| --- | --- |
| Public snapshot commit / public tag object | `6050561e05c2883b84728b3f65ce854b70dccf20` / `f1a5696e41ffd6d10d48866ab9f5b7af2971d243` |
| darwin-arm64 archive sha256 | `da98a10e273b02403fb33b12e2292e1006d6ddd61b5eac92c43007eddc2229f2` |
| darwin-x64 archive sha256 | `8a19e9aaef00a106778c16c5fd70631b2c0389bc3e7c8e35398d89626f83d5a8` |
| linux-arm64 archive sha256 | `5770dd8a7be55cc376272cf83d3fe10c603bb105bdf8e2b1c4dd305ddbb3dc12` |
| linux-x64 archive sha256 | `a5cc431978353709fdf5a5c58cd218221545388a322b4a902d20aef64c41dcf9` |
| Installer bytes (live == versioned) | `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900` |
| Homebrew / Nix pin commit | `971fe3d740f2a8c76e84a22f8ac801b787b7589c` |

## 2. How to reproduce

From any checkout with the tooling committed (see `fixtures/onb-001/README.md`):

```sh
git worktree add --detach <short-temp-root>/onb-001-baseline-src v1.22.0
# install dependencies for that worktree (or symlink node_modules from a full install)
npx tsx fixtures/onb-001/capture-first-run.ts --root <short-temp-root>/onb-001-baseline-src
npx tsx fixtures/onb-001/capture-return.ts    --root <short-temp-root>/onb-001-baseline-src
npx tsx fixtures/onb-001/capture-join.ts      --root <short-temp-root>/onb-001-baseline-src
npx tsx fixtures/onb-001/capture-viewer.ts    --root <short-temp-root>/onb-001-baseline-src
npx tsx fixtures/onb-001/verify-evidence.ts   --root <short-temp-root>/onb-001-baseline-src
```

Every tool exits nonzero unless all of its cases were captured, so the last
line of each run is a machine-checkable result. `verify-evidence.ts` then
rewrites `MANIFEST.json` and fails on any forbidden string, residual unmasked
id, or summary/hash mismatch.

## 3. Isolation and hygiene (what was and was not touched)

- Each case ran in a fresh scenario with its own `HOME`, `XDG_CONFIG_HOME`,
  `CAMPFIRE_CONFIG_DIR`, `CAMPFIRE_DATA_DIR`, and `TMPDIR` under the system
  temp directory; no real `~/.campfire*`, `~/.codex`, `~/.config/opencode`, or
  developer database was read or written.
- `CAMPFIRE_URL` / `CAMPFIRE_TOKEN` were removed from every child environment;
  every listener bound loopback with `--port 0` / `--viewer-port 0`; every
  daemon was stopped with a real SIGINT and no listener outlived its run.
- Harness presence is **simulated**: a marker directory created at the exact
  config path the v1.22.0 detector checks, inside the isolated HOME/XDG. No
  codex or opencode process was launched, and no real harness config was
  modified. `onboard`/`join` therefore exercise real shipped code with a
  simulated harness inventory; the summaries label this per case.
- No real browser was launched. The fresh-run browser branch is pinned with an
  `open` shim on `PATH` that only logs the URL; the Viewer DOM dumps use a
  headless Chromium shell with an isolated `--user-data-dir`.
- Owner listener stderr carries its own authz lines (for example an
  `"allow":false … "method":"whoami"` line during recipient activity). Those
  lines are recorded as observations in the join summary, never asserted.

## 4. Masking rules (deterministic, applied before writing)

Secrets and dynamic values are masked BEFORE any evidence file is written;
a surviving forbidden string aborts the write and is reported. Recording:

| Rule | Replacement |
| --- | --- |
| bearer tokens (`cft~` shapes) | `[redacted]` |
| invitation secrets (`cfe~` shapes) | `[one-time-credential: redacted]` |
| absolute home / temp paths (`/Users~`, `/private~`, `/var/folders~`, `/tmp~` prefixes) | `[path]` |
| loopback ports | `127.0.0.1:[port]`, `localhost:[port]` |
| ISO timestamps | `[timestamp]` |
| UUIDs | `[uuid]` |
| object ids (`<prefix>_<16 hex>`) | `<prefix>_[id]` |
| enrollment invitation ids | `ein_inv_[id]` |

(A trailing `~` marks a literal forbidden prefix; the tilde convention follows
`safeMention` in `fixtures/onb-001/lib/capture.ts` so this document itself
contains no forbidden needle.) Exit codes, staged strings, and all exit
behavior are preserved unmasked; only values are normalized. The only dynamic
values retained are non-identifying numeric observations (for example
participant counts), never credentials.

## 5. Packet layout

- `summaries/*.json` — one per capture tool: baseline facts, per-case
  simulated/real/not-captured labels, exit codes, checks, per-file sha256 and
  applied masking rules, method notes.
- `terminal/*` — raw PTY streams and the browser-branch `open` shim log.
- `machine/*` — piped stdout/stderr, explicit JSON receipts, failure bodies.
- `browser/*` — headless DOM dumps of the served Viewer.
- `MANIFEST.json` — every file with bytes, sha256, provenance label, and the
  cross-check against the summaries; regenerated by `verify-evidence.ts`.
- `PINNED_STRINGS.md`, `ANSWER_KEY.md` — the ambiguity pin and the per-state
  key required by the sprint contract Step 0.

## 6. Provenance statement

Everything in this packet was produced by shipped v1.22.0 code executing in an
isolated environment. "Simulated" and "real" labels are per case in the
summaries; no codex/opencode process, real profile, real invitation delivery,
or person's browser contributed to the captures. Treat every statement here as
engineering evidence about the released binary, not as a user outcome.
