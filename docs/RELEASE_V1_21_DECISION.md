# v1.21.0 release decision — Artifact Reference Handoff (scoped candidate)

**Date:** October 17, 2026

**Status:** Founder-directed public release, recorded as the separate founder release-scope decision that ARH-001 contract §7/§0 require. Publication, channel pins, and production deployment are recorded in the promotion table as they complete.
**Package target:** `1.21.0`
**Contract:** `docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md` (§0 founder sequencing amendment; §3.3–5 security and scope limits)
**Candidate scope (frozen before code):** `docs/Campfire-v1.21-ARH-001-CANDIDATE-SCOPE.md` (commit `5258d5b`)
**Sprint result:** `docs/SPRINT_ARH_001_RESULT.md` — §1–§8 **UNSCORED** (observations NOT OBSERVED, unchanged); §9 records the scoped candidate as **ENGINEERING PASS — human outcome NOT OBSERVED**
**Candidate commits:** scope freeze `5258d5b`; implementation `ace3b0f`; result/evidence `d0e16f4`

## Why this release exists

On October 16, 2026 the founder amended the ARH-001 contract (§0) prospectively: a bounded artifact-navigation candidate may be implemented and released after reproducible local engineering checks pass, without a multi-person observation, with a separately recorded release decision. The scoped candidate was subsequently frozen (`5258d5b`), implemented (`ace3b0f`), independently verified, and recorded as **ENGINEERING PASS — human outcome NOT OBSERVED** (`d0e16f4`). The founder then directed, verbatim (October 17, 2026 UTC boundary; acting in the `Campfire-Internal` repository):

> "fully commit/push and release to the public now please v.1.21. use subagents to help you"

This document is that recorded release decision. It is **not a human-outcome result and is not a GO/CONDITIONAL-GO verdict change**:

- ARH-001 §1–§8 remains **UNSCORED**; the ordinary-work reference-open attempt (§3.2), the two-human/two-harness handoff (§6), and every item H1–H6 remain **NOT OBSERVED**. Nothing is rescored.
- The candidate's **ENGINEERING PASS** states only that the tested behavior works as governed (D1–D6, typecheck, suite, build, packaging/deployment dry run, and direct terminal/browser inspection at the recorded commits). It does not state that any person can reach an external target, complete a handoff, comprehend the surface, or return to it. The approximately-500-daily-users figure remains an operating claim by the founder, not a verified metric in this record, and presents no evidence about this feature.
- Real ordinary-work observations may follow publication when eligible people and tasks exist, under the original §2/§6 procedures; any later observation is recorded under its own date and never rewrites this record. Human observation being open does **not** block this release under §0.

## The exact release surface (nothing else)

The published v1.20.1 surfaces gain exactly the scoped candidate (`ace3b0f`) and no other product change:

- **Typed reference projection** on both human surfaces (terminal dashboard and local read-only Viewer): each authorized Artifact's stored reference is classified by a frozen deterministic taxonomy — `openable https` / `insecure http` / `credential-bearing` / `local path` / `other scheme` (including internal record forms like `git:<sha>`) / `unparsed` / `none`, with C0/C1 control characters forcing inert. The destination host is shown for openable references before any navigation.
- **Deliberate open control, Viewer only, for `openable https` only:** explicitly labeled ("Open `<host>` (external, unverified)"), `target="_blank"`, `rel="noopener noreferrer"`, `referrerpolicy="no-referrer"`, keyboard-reachable, escaped markup; navigation happens only on the user's own activation. Rendering, refresh, hover, and source inspection make **zero** network requests (browser-asserted with request interception at wide and 420px viewports).
- **Recorded cited-by relations:** where the same authorized read records a Finding→Artifact `supports`/`contradicts` citation, the artifact row shows it as the recorded relation. No relation is ever inferred; absence is not asserted beyond the read; historical and competing decisions are not promoted.
- **Terminal dashboard:** inspect-only (class, host, recorded cited-by, caveat). No open action, no shell command, no local-file open.
- **Caveat text on both surfaces:** the target is external and unverified by Campfire, and workspace membership does not grant access.
- **Unchanged:** CLI JSON shapes, MCP tools/contracts, the five `VIEWER_READ_METHODS`, service, schema/migrations, `wrangler.toml`/Worker assets, installer scripts, GWV. No server-side fetch, proxy, preview, automatic navigation, credential, token, or new dependency. No telemetry change; no new events.
- The `docs/mockups/` Navigator HTML added with commit `44f7bc2` is a founder design reference only — not shipped behavior, not scope, evidence of nothing.

## Evidence that remains open or unmeasured

| Evidence | Status in this release |
| --- | --- |
| ARH-001 §3.2 ordinary-work attempt, §6 two-human/two-harness handoff, H1–H6 | **NOT OBSERVED** (unchanged; UNSCORED verdict stands) |
| Deterministic D1–D6 candidate checks, typecheck, full suite (95 files / 1161 + 1 opt-in skipped), build, `pack:tarball`, `deploy:dry-run`, terminal/browser inspection | **Engineering PASS**, recorded in result §9 with the two-pass verification chain and the browser-capture evidence (`docs/evidence/arh-001/candidate/`) |
| Whether a real user opens an external output and completes a handoff | **Unmeasured.** Later observations record it under their own date, per §2/§6. |
| VIS-001 condition 4; SWH-001/WCO-001/ATT-001/UIX-001 observations; Gate B/C/E/F | **Unchanged/unmeasured.** This release satisfies none of them and moves none. |
| A live interactive human walk of the released surface | **Unmeasured.** The pre-release browser check was headless, scripted, at two viewport sizes. |

## The exact public claim

Campfire v1.21.0 makes cited external work easier to inspect and deliberately open. Authorized artifact references now render on the terminal dashboard and the local read-only Viewer with a typed, deterministic reference class, the destination host for safe links, and the recorded Finding→Artifact evidence relation where one exists. The Viewer adds a clearly labeled open control for safe absolute HTTPS references: it shows the destination host, marks the target external and unverified by Campfire, and navigates only when you yourself activate it (`noopener noreferrer`, no referrer). Rendering itself performs no fetches; the terminal remains inspect-only; CLI JSON, MCP, the Viewer's five read methods, and all schemas are unchanged. **It is experimental**: no person has yet been observed using this to reach, verify, or act on an external output in ordinary work; the ARH-001 human observations are NOT OBSERVED and the UNSCORED result stands; Gate B/C/E/F and the earlier sprint observations remain open. Campfire never fetches, hosts, or verifies the external target, and Campfire workspace membership does not grant access to it.

## What users should know

- The open control is your action, to your external system with your own access. Campfire adds nothing to your authorization there. If the link is stale or your access is denied, Campfire says nothing about it — it never probes the target.
- Credential-bearing, insecure HTTP, local-path, and exotic-scheme references never become open controls; they stay labeled inert text. Hostile markup stays escaped.
- `git:<sha>` and similar internal record forms are classified as non-openable record references — that is correct, not a defect.
- Agents see no new tool, method, or credential; the browser remains token-free.
- No object, schema, migration, notification, or write path is added.

## Promotion record

Each step is recorded with its evidence as it completes; no check is loosened. The private-repository CI install-channel assertion is expected to fail until the post-release pin commit (pre-recorded as the expected failure, not a defect).

| Step | Evidence |
| --- | --- |
| Founder direction, candidate chain, and prep checks | This document; prep commits `44f7bc2` (founder Navigator/ROADMAP edits), `5258d5b`→`d0e16f4` candidate chain, `6d39a51` (decision + `1.21.0` bump and pre-verification: typecheck PASS; full suite 95 files / 1,166 tests — 1,164 passed, 1 opt-in capture skipped, 1 expected install-channel assertion awaiting the v1.21.0 archives, **not loosened**; build PASS with `public/` byte-identical to `src/viewer/static/`; Darwin ARM64 packaging sha256 `3d2297adeb213f597ea7649987cb44a38ce74391bdf4a0a3a94c3dd3b8fb699c` with extracted package `1.21.0`; deploy dry-run PASS, wrangler 4.149.0, 61 public assets), and `5523305` (pre-tag fixes: ARH sample path sanitized for the export audit, `1.21.0` public claim added to CHANGELOG/RELEASE_CONTEXT, versioned installer tracked). Fresh export audit at `v1.21.0`: PASS — 315 files incl. manifest (`sourceCommit` `5523305…`, exported `2026-10-17`); token/home-path/sentinel sweeps clean. |
| Private annotated `v1.21.0` tag | Pushed origin `main` (`76db5be..5523305`) and tag. Annotated tag object `38e03e88873ea742177eeb0b92ae2561fa6dae8d` → commit `5523305ec1c7334d8789b4c895610ff13f266d5a`. Private CI at both pushes (runs `39002149501`, `39002149505`) failed only on the expected install-channel assertion (`expected … to contain '/v1.21.0/'`) — not loosened. |
| Audited public source snapshot | Published. Public commit `5dd00f99ae4aebf44148e54f87911ac8c6aeb266` on top of `8feaa76`; public annotated tag `v1.21.0` (object `e97ea4acdf592f16721989631840b3ddccbe75f8`). The push's rule-bypass note for the required `ci` check is the documented pre-pin state. Export manifest: 315 files; delta vs `8feaa76` = +11 (the 8 ARH fixture files, the 2 ARH test files, and the tracked `campfire/v1.21.0/install.sh`). |
| Public GitHub Release and four checked archives | Published. Release `v1.21.0` live at `github.com/BoringInfraCo/Campfire/releases/tag/v1.21.0` with the exact public claim. Workflow `39002799456` (4/4 platform jobs: darwin-arm64, darwin-x64, linux-x64, linux-arm64) attached eight assets (four archives + four `.sha256`). Local `shasum -a 256 -c` on all four downloaded checksum files passed: darwin-arm64 `8dd62e1e0656899be58d8b177539a440985e491697991a0859a4cf899dd5e8c7`, darwin-x64 `4b419a9f…`, linux-arm64 `ab1f900d…`, linux-x64 `006cff15…`. Extracted darwin-arm64 archive reports package `1.21.0`. |
| Homebrew / Nix pins, tap promotion, installer checks | Private pin commit `28d7ca94237aa7bb068a7500206099da438d1bf3` (full suite 95 files / all tests passing, 1 opt-in capture skipped, after the pin — the pre-pin expected install-channel assertion went green). Public addendum `4ef62c6` records `installChannelsCommit` (with a path-correction follow-up `f051099` moving `packaging/homebrew/campfire.rb` into place). Homebrew tap `BoringInfraCo/homebrew-campfire` promoted as `2223e86` (`campfire 1.21.0`). |
| Production Worker deployment and live verification | Deployed. Cloudflare Worker version `d4e537cd-e465-4c15-a847-36efde627175` (wrangler 4.149.0; 63 assets read — 2 modified uploaded (`app.js`, `app.css`), 31 already uploaded; Total Upload 345.91 KiB / gzip 65.62 KiB; route `boringinfra.company/campfire/*`, `campfire.boringinfra.co` does not resolve and the product has no `/live` route — the deployed Worker itself answered `/campfire/live` with its own validation error, which is the live-touch evidence). Live and versioned installer URLs are byte-identical to the tracked files (sha256 `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`). A clean install from the versioned URL into an isolated prefix verified the published archive checksum (`8dd62e1e0656899be58d8b177539a440985e491697991a0859a4cf899dd5e8c7`), reported package `1.21.0`, suppressed telemetry only via the documented `CAMPFIRE_TELEMETRY=0` env (the bare default resolves `enabled`, per `docs/TELEMETRY.md`), and the CLI ran. |
