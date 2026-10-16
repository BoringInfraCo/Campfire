# v1.19 release decision — Trustworthy Team Attention

**Date:** October 15, 2026 (local; promotion timestamps cross October 16 UTC)

**Status:** Founder-directed full public release; prep checks recorded below. Publication, channel pins, and production deployment are separate promotion steps and are recorded in the promotion table as they complete.
**Package target:** `1.19.0`
**Contract:** `docs/Campfire-v1.19-ATT-001-Trustworthy-Team-Attention.md`
**Sprint result:** `docs/SPRINT_ATT_001_RESULT.md` (CONDITIONAL GO — engineering candidate)

## Founder direction and scope

On October 15, 2026, the repository owner directed a full public v1.19.0 release:

> "lets fully publish v1.19 … i want to fully publish this as im the founder"

The owner also forwarded and endorsed the reviewer framing of the bounded public
claim: publish the verified coverage and review-cue behavior, and keep the human
result explicitly open.

This is the **separate, recorded founder override** that contract §7 requires
for publication with an open human observation. It is a release-scope override
of the ATT-001 evidence hold. It is **not** a GO verdict:

- ATT-001 remains **CONDITIONAL GO — engineering candidate**
  (`docs/SPRINT_ATT_001_RESULT.md`).
- The eligible two-person controlled comprehension trace is **NOT OBSERVED**;
  the labeled subagent rehearsal produced zero H1–H6 human observations and
  cannot substitute for one.
- D1–D6 pass, and independent verification (including the two mutation
  survivors closed in `d7addb2`) supports the implementation behavior only.

The bounded release surface is the ATT-001 change and nothing else:

- `get_workspace_context` carries `attentionCoverage` derived from the same
  returned task and decision slices (no extra read), and `needsAttention`
  carries an `accepted_decision_needs_review` cue for each returned accepted
  decision whose read-time `needsReview` decoration is set, with its cited
  non-current finding ids. The cue never appears in `needsYou`, never revives a
  superseded decision, and is not elevated to `suggestedNextAction`.
- The Viewer qualifies empty and nonempty attention lists with page coverage,
  labels reasons in plain language (raw codes retained in `data-reason`), and
  states that recorded assignment is not a permission; the CLI and MCP
  description align. The five Viewer read methods, page budgets, schema, and
  migrations are unchanged.

## Evidence that remains adverse or absent

| Evidence | Release record |
| --- | --- |
| ATT-001 H1–H6 two-person comprehension trace | **NOT OBSERVED.** One operator available; contract §6 forbids substituting agents or the builder. Frozen materials: `docs/evidence/att-001/` (`TRACE_RUNBOOK.md`, `PARTICIPANT_PACKET.md`, `SCORING_FORM.md`, `SCENARIO_KEY.md`). |
| Subagent rehearsal | **Debug only**; zero H1–H6 human observations. |
| D1–D6 deterministic checks | **Pass** at `bb007c7` + `d7addb2`: focused 23/23; full suite 88 files / 1,101 tests; typecheck, build, Darwin ARM64 packaging, and Worker deployment dry run recorded in the sprint result. |
| Gate B / C / E / F | **Unmeasured.** Publication satisfies none. |
| WCO-001 two-human/two-harness case | **NOT OBSERVED** (unchanged). |
| SWH-001 controlled traces; VIS-001 condition 4 | **Not run** (unchanged). |

## The exact public claim

Campfire v1.19 makes the existing attention view honest about its own coverage
and surfaces accepted decisions that still cite non-current evidence: the
workspace context states the returned task and decision page counts and whether
the attention lists are complete under their selection rules, and it carries a
team review cue with the cited non-current finding ids that neither revokes
acceptance nor chooses an operative decision. It is **experimental**: no
two-person comprehension result is recorded for this sprint, ATT-001 remains
CONDITIONAL GO — engineering candidate, and Gate B, Gate C, Gate E, and Gate F
remain open.

## What users should know

- Truncated pages can hide a matching cue; an empty qualified list means no cue
  matched the returned records — never that the team is done.
- The review cue asks for human review. Acceptance, proposal, supersession, and
  recorded replacement keep their recorded meanings; nothing here withdraws,
  invalidates, or replaces an accepted decision.
- Recorded assignment is a record, not a permission: writes still pass the
  workspace authorization check and are recorded with the real actor's
  provenance.
- No new read surface, object, schema, migration, notification, or coordination
  action is included.

## Promotion record

Each step is recorded with its evidence as it completes; do not loosen a check.

| Step | Evidence |
| --- | --- |
| Founder direction and prep checks | This document; prep commit `4641dec`. Typecheck clean; full suite 88 files / 1,100 passing with the one expected install-channel assertion awaiting the v1.19.0 archives (not loosened); Darwin ARM64 packaging built (local sha256 `b8fb8c2a970b753917d2076e5288b8e6bf8478c7ac4eee9f294cff61470438d3`), archive extracts with package `1.19.0`; versioned installer created; Worker deployment dry run passed. |
| Private annotated `v1.19.0` tag | Pushed. Annotated tag object `c3e252e` → commit `4641dec`. |
| Audited public source snapshot | Export audit passed, 295 files + manifest. Public commit `e208a071` on top of `dd60eef`; public annotated tag `v1.19.0` (object `0dd1f91`). |
| Public GitHub Release and four checked archives | Published. Workflow `38845444171` completed successfully; eight assets attached (four archives + four checksums). Pre-pin snapshot `ci` runs failed only on the expected install-channel assertion (`expected formula to contain '/v1.19.0/'`), which was not loosened. Local `shasum -a 256 -c` on the published `campfire-darwin-arm64.tar.gz` passed. |
| Homebrew / Nix pins, tap promotion, installer checks | Private pin commit `4a6f5c5eee1835f58dc7aae5ee6a7f97c9022632` (suite 1,101/1,101 after pin). Public post-tag addendum `636165f` records `installChannelsCommit` in the manifest; the addendum message's hand-typed hash was corrected append-only in `3b4a91a` (manifest was already correct). Homebrew tap `BoringInfraCo/homebrew-campfire` promoted as `243332f` (`campfire 1.19.0`). |
| Production Worker deployment and live verification | Deployed. Cloudflare Worker version `09f29f22-1f56-4993-8747-54e91080e3f5`. Live and versioned installer URLs are byte-identical to the tracked files (sha256 `ba8603bd106277bf520b1789b77e4e95c8b2bc9c9cae5db5059965bf25d26900`). A clean install from the versioned URL into an isolated prefix reported package `1.19.0` with telemetry disabled and the CLI ran. |
