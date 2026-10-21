# v1.25.0 release decision — CAP-001 Discover and Compose (minor)

**Date:** October 20, 2026

**Status:** Release prep. Founder-directed release recorded below; the promotion table is filled as each step completes.
**Package target:** `1.25.0`
**Contract:** `docs/Campfire-v1.25-CAP-001-Discover-and-Compose.md`
**Sprint result:** `docs/SPRINT_CAP_001_RESULT.md` — **CONDITIONAL GO — engineering candidate**: D1–D7 pass; both targeted harness runs used discovery and the two read recipes and named the required ids; automatic adoption and improved continuation over v1.24.1 remain unproven; the optional non-builder human comparison is **NOT OBSERVED**.
**Candidate commits:** Step 0 freeze `1b212fe`; capability search and read recipes `9107368`; implementation result `59e48e1`; harness smoke and export audit `d3e45a0`; targeted smoke `a1df6a3`; release-prep corrections `fd75753`.

## Founder direction and release boundary

On October 20, 2026 the founder directed this release in the `Campfire-Internal` repository, verbatim:

> "lets commit/push/tag/release @Campfire-Internal/docs/Campfire-v1.25-CAP-001-Discover-and-Compose.md heres our progress and go!"

The founder also directed the release posture, verbatim:

> "**Yes—I now recommend moving v1.25.0 into release prep.** Both harnesses successfully used discovery and both recipes, returned the correct records, and made no writes. The export audit also passed."
>
> "Keep the recorded **CONDITIONAL GO** and publish the bounded claim: shared capability search and two read recipes. Automatic adoption and improved continuation remain unproven."
>
> "Record the founder release decision, then run the versioned release checks and promotion process."

This is the separate founder release decision that contract §6 D7 and §8.5 require before a version bump, tag, public snapshot, channel pin, or deployment. It authorizes the private commit and push, the `1.25.0` version bump and annotated tag, the audited public snapshot and GitHub Release, install-channel promotion, and the production deploy.

This document does **not** convert the sprint verdict to GO:

- The public claim is bounded to **shared capability search and two read recipes**. Automatic adoption, fewer failed discovery calls, and improved continuation over v1.24.1 are **NOT OBSERVED** and are not claimed.
- The unprompted smoke is mixed: OpenCode reached the correct ids through its harness tool index without calling discovery; Codex stopped at a truncated orientation and missed the later blocked task. The targeted smoke told both harnesses to use discovery and a recipe; both then completed with the required ids. A prompt that names the capability is not evidence of spontaneous adoption.
- The optional non-builder human comparison is **NOT OBSERVED**. Nothing in this release is a human-comprehension result.
- The search phrase `"read recipe"` matches neither operation entries nor recipe summaries. The selected path still works through narrower queries and recipe ids. This is a recorded follow-up, not a release blocker and not a claim.
- No gate is moved. Gate B/C/E/F, NAV-001/002/003, ONB-001, UIX-001, ATT-001, SWH-001, WCO-001, ARH-001, and VIS-001 condition 4 keep their recorded status.

## The exact release surface (nothing else)

The published v1.24.1 surface gains exactly the CAP-001 candidate plus the release-prep corrections:

- **Shared static catalog** (`src/catalog/capability-search.ts`): one semantic corpus drives the CLI and MCP adapters. The gate-off corpus is the frozen Step 0 operation set. `CAMPFIRE_PLAYBOOK=1` / MCP `playbookEnabled === true` adds the existing `get_playbook` definition; otherwise it is absent.
- **Bounded CLI search** (`campfire capabilities --search <query> [--limit <1..10>] [--output auto|human|json]`) and **MCP discovery** (`discover_capabilities({query, limit?})`) return the same `kind: "capability_search"`, `catalogVersion: 1` projection. Entries carry `id`, `purpose`, `effect`, `scope`, `requiredInputs`, `preconditions`, `outputCaveat`, and `surfaces` with explicit `{usage}`, `{tool}`, or `{unavailable}`. `recipeSummaries` carries matching recipe ids and one-line purposes.
- **Deterministic bounds**: case and whitespace normalization, 120-character query cap, default 8 / maximum 10 operation entries, stable id ordering, 16 KiB projection cap, and `returned`, `totalMatches`, and `truncated` computed over operation entries. Empty, malformed, or overlong input and unknown recipe ids use the existing `ValidationError` envelope with a bounded `field` value.
- **Two static read recipes** (`continue-blocked-work`, `review-decision-basis`) through `campfire capabilities --recipe <id>` and `get_read_recipe({id})`. Each recipe is a `kind: "read_recipe"`, `recipeVersion: 1` document of ordered references to existing authorized reads, with `inputsFrom`, `surfaces`, `stopWhen`, `coverageCaveat`, and `resultContract`. `get_record_history` stays MCP-only; the CLI mapping is explicitly unavailable and a CLI client stops with a labeled history gap.
- **No workspace access from discovery**: search and recipe fetch take no store. They expose no workspace name, id, row count, membership verdict, token, secret, environment value, or credential receipt. A catalog entry or recipe step is not a grant; the invoked method still authorizes. The operator-only bridge stays CLI-only.
- **Compatibility preserved**: unqualified `campfire capabilities --output json` remains the version-1 `cli_command_manifest` with only additive variant descriptions on its `capabilities` entry. Existing CLI direct outputs, option parsing, MCP tool names/schemas, HTTP `/v1/call`, the Viewer read allowlist, session instructions, telemetry activation boundaries, and opt-in playbook behavior are unchanged. `discover_capabilities` and `get_read_recipe` are the only MCP tool-list additions. No `/v1/call` method, migration, domain object, Viewer panel, external integration, general skills platform, or code runner is added.
- **Release-prep corrections** (`fd75753`): Step 0 Amendment 1 copies the frozen contract JSON to `fixtures/cap-001/contract/` so the public snapshot can run its exported CAP-001 tests without exporting `docs/evidence/`; a private parity test keeps the copies equal. The now-false `capabilities` MCP unavailable sentence was corrected in the frozen catalog and inline corpus. The result and smoke records were reconciled with the later harness runs.
- **Versioned installer**: `public/campfire/v1.25.0/install.sh` is tracked from the current installer. Published `v1.24.1`, `v1.24.0`, `v1.23.0`, `v1.22.1`, and `v1.22.0` installer copies are immutable and are not edited.

## Evidence status in this release

| Evidence | Status in this release |
| --- | --- |
| D1 — released contract preservation | PASS. Unqualified manifest envelope, command order, output modes, and playbook gate preserved; only the `capabilities` entry gains `--search` and `--recipe` variants. |
| D2 — catalog parity | PASS for the frozen query cases and live `tools/list` parity. CLI and MCP return the same logical ids, effects, preconditions, invocations, and recipe summaries. |
| D3 — bounded deterministic search | PASS. Limits, tie order, normalization, hostile/empty/overlong input, zero matches, the 16 KiB budget, and fixture-id exclusion are covered. |
| D4 — authority separation | PASS. Discovery and recipe fetch take no store; denied and wrong-workspace actors gain no workspace data; static text never asserts a grant. |
| D5 — recipe fidelity | PASS. Both recipe ids parse equal from CLI and MCP, remain under 8 KiB, name only existing reads or explicit unavailable surfaces, and carry stop/coverage rules. |
| D6 — cross-harness continuation | **Engineering fixture PASS; targeted live runs PASS; automatic adoption and v1.24.1 improvement NOT OBSERVED.** Unprompted OpenCode named the ids without discovery; unprompted Codex stopped at the truncated orientation. Targeted runs on both harnesses used discovery and the recipes and named the required ids. |
| D7 — distribution and regression | PASS. Typecheck, full suite, build, isolated `pack:tarball`, public-snapshot test run, export audit, and `deploy:dry-run` are recorded below. The pre-pin install-channel assertion is expected and is closed by the post-publication pin. |
| Human comparison | **NOT OBSERVED.** One operator; no eligible non-builder pair. Not converted into a pass by this release. |
| Gates and earlier sprint verdicts | **Unchanged.** This release satisfies none of them and rescores none of them. |

## Public release notes (v1.25.0)

Used verbatim for the GitHub Release body:

```markdown
Campfire v1.25.0 — Discover and Compose

Campfire can now describe its installed interface to an agent and guide two short read-only sequences over existing authorized records.

- `campfire capabilities --search <query>` and the read-only MCP tool `discover_capabilities` return the same bounded, versioned projection of installed operations. Each entry names a stable id, purpose, effect, scope, required inputs, preconditions, output caveat, and an explicit CLI and/or MCP invocation. An interface absent on one surface is marked unavailable, never fabricated. Search uses deterministic normalization and limits, and it opens no workspace store.
- `campfire capabilities --recipe <id>` and the read-only MCP tool `get_read_recipe` return two static recipes: `continue-blocked-work` follows existing authorized reads from workspace selection through bounded orientation and task paging to a selected task and only its recorded citations; `review-decision-basis` follows a selected decision into its recorded basis and the currentness of the cited findings. Every step names its input source, invocation, stop rule, and coverage caveat. `get_record_history` is MCP-only, so a CLI client stops and labels that gap instead of substituting a workspace-wide activity read.
- Discovery is not authority. A catalog entry or recipe step is not a grant, a verified plan, or an authorization result; the invoked operation still enforces workspace access and agent-session requirements. Search may run before workspace selection and exposes no workspace name, id, row count, membership verdict, token, secret, environment value, or credential receipt. Recipes run no server work, write nothing, and store no workspace data.
- The unqualified `campfire capabilities --output json` manifest keeps its version-1 envelope and existing meaning; only its `capabilities` entry gains the two additive variant descriptions. Existing CLI output, MCP tool names and schemas, HTTP contracts, the read-only Viewer and its allowlist, telemetry boundaries, and the opt-in playbook gate are unchanged. `discover_capabilities` and `get_read_recipe` are the only MCP tool-list additions. There is no new write path, schema, migration, domain object, Viewer panel, or code runner.
- Both targeted harness runs used discovery and both recipes and named the required fixture ids without a write. Automatic adoption and improved continuation over v1.24.1 remain unproven: the earlier unprompted run did not call discovery, and no baseline comparison was measured. The optional non-builder human comparison is NOT OBSERVED. This release is a bounded engineering claim, not a human-comprehension result and not a gate result.

Darwin and Linux archives for ARM64 and x64, with SHA-256 checksum files, are produced by the release workflow. The versioned installer at `campfire/v1.25.0/install.sh` pins this release.
```

## What users should know

- Search describes what the installed client can call; it does not say the acting actor is authorized, does not read workspace state, and does not choose an operation for the agent.
- A recipe is navigation over existing reads. The client supplies workspace ids and cursors from prior authorized results. A denied, missing, stale, or truncated read stops or labels the gap; it is not silently completed.
- `needsReview` remains a review cue, not revocation and not permission to act. An assignee remains a recorded fact, not live presence. A first page remains a page, not the workspace.
- A truncated page with no `nextCursor` is the end of that traversal, not proof that the first page was complete.
- The `"read recipe"` phrase does not match the catalog; use a work or decision phrase, or the recipe id. This is a recorded follow-up.
- Automatic adoption and improved continuation are unproven. The human comparison is NOT OBSERVED.

## Promotion record

Each step is recorded with its evidence as it completes; no check is loosened. Publication starts only after the release-prep verification battery passes on this revision. The private CI install-channel assertion is expected to fail until the post-publication pin commit (pre-recorded as the expected failure, not a defect).

| Step | Evidence |
| --- | --- |
| Founder direction and release-prep revision | This document and release-prep commit on `main`; `package.json` and `package-lock.json` at `1.25.0`; tracked `public/campfire/v1.25.0/install.sh`; prior installer copies verified untouched. |
| Release-prep verification battery | PASS at `a8a7186`: `npm run typecheck`; full `npm test` 103 files / 1,298 passed / 1 pre-recorded install-channel failure / 1 opt-in skip (1,300); `npm run build`; `npm run deploy:dry-run` (75 assets); `npm run pack:tarball` (extracted package `1.25.0`); audited public export at the same commit wrote 357 files and its exported CAP-001 tests passed 36/36. The install-channel failure remains the expected pre-pin assertion and was not loosened. |
| Private annotated `v1.25.0` tag | Pending. |
| Audited public source snapshot and tag | Pending. |
| Public GitHub Release and four checked archives | Pending. |
| Homebrew / Nix pins, tap promotion, installer checks | Pending. |
| Production Worker deployment and live verification | Pending. |
