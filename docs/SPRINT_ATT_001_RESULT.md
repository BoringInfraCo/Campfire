# Campfire — Sprint ATT-001 Result: Trustworthy Team Attention

**Date:** October 15, 2026 (local; capture timestamps cross October 16 UTC)

**Status:** **CONDITIONAL GO — engineering candidate.** The D1–D6 focused checks pass on the recorded candidate and no known safety failure remains; the eligible two-person controlled comprehension trace is **NOT OBSERVED** (recorded reason below). No version bump, tag, public snapshot, installer pin, release decision, or deployment is part of this result. The founder subsequently directed a full public v1.19.0 release under the recorded release-scope override in `docs/RELEASE_V1_19_DECISION.md`; that override does not change this verdict, the open human trace, or any gate. This record does not claim human comprehension, ordinary team value, Gate B/C/E/F, or resolution of the open WCO-001 and SWH-001 observations.

**Contract:** `docs/Campfire-v1.19-ATT-001-Trustworthy-Team-Attention.md`
**Evidence:** `docs/evidence/att-001/` (baseline, candidate, restricted key, participant packet, scoring form, trace runbook)
**Baseline:** published `v1.18.0` (tag `7f60649`); fresh capture pinned in `docs/evidence/att-001/baseline/PIN.md`
**Fixture:** `fixtures/attention/att-001/` — scenario v2 (repair recorded in `docs/evidence/att-001/baseline/SCENARIO_REPAIR.md`)

## 0. Verdict and what it does not claim

Contract §7: **CONDITIONAL GO — engineering candidate** applies when D1–D6 pass, no known safety failure remains, and the eligible human trace is unavailable for a recorded reason. That is this case:

- **Recorded reason for the missing human trace:** the engineering session had one human operator. Contract §6 requires **two different people**, at least one of whom did not build the candidate, and §6 explicitly forbids substituting agents, subagents, or the builder for a human answer. No eligible pair was available. The frozen packet, scoring form, and runbook are ready for a future trace.
- A labeled **fixture-only subagent rehearsal** was run for debugging (see §6). It produced zero H1–H6 human observations and is not evidence of comprehension.
- No release decision was requested or recorded. `docs/RELEASE_*` contains nothing for v1.19.0 because none exists. Publication, a tag, or deployment require a separate founder decision per contract §7.
- Gate B, Gate C, Gate E, Gate F, VIS-001 condition 4, the WCO-001 two-human case, and the SWH-001 observations are untouched.

## 1. What is in the tree

**Product change (commit `bb007c7`, refined by `d7addb2`):**

- `src/service/service.ts` — `attentionCoverage` type and field; `accepted_decision_needs_review` reason; `needsReviewFindingIds` on an attention item.
- `src/service/campfire-service.ts` / `src/worker/async-service.ts` — the sync and async `deriveOrientation` implementations append a review cue for the returned accepted decisions carrying the read-time `needsReview` decoration; identical logic in both.
- `src/service/context-assembly.ts` — `attentionCoverage` derived from the same task/decision slice values the projection already computed; no additional read.
- `src/cli/index.ts` / `src/cli/projections.ts` — attention sections always render with qualified empty text; one coverage line; the review cue shows its cited non-current finding ids and its meaning.
- `src/mcp/tools.ts` — the `get_workspace_context` description states coverage and cue semantics; the tool list and input schema are unchanged.
- `src/viewer/static/{app.js,index.html,app.css}` + `public/*` sync — coverage-qualified empty and nonempty attention lists, plain-language reason labels with the raw code kept in `data-reason`, cited finding ids, recorded assignee, and the statement that recorded assignment is not a permission grant or denial.
- `tests/integration/att-001.test.ts` — 23 focused tests spanning D1–D6.

**Fixtures, evidence, and materials (commit `b18a536`):**

- `fixtures/attention/att-001/` — deterministic seed (v2), frozen-clock dump, Playwright capture; no database or token committed.
- `docs/evidence/att-001/baseline/` — v1.18.0 pin, served state, captures, write probe, gap probes, scenario repair, SHA256SUMS.
- `docs/evidence/att-001/candidate/` — candidate served state, captures, probe, hashes (committed with this record).
- `docs/evidence/att-001/SCENARIO_KEY.md` (restricted), `PARTICIPANT_PACKET.md`, `SCORING_FORM.md`, `TRACE_RUNBOOK.md`, `README.md`.

**Not changed:** SQLite/D1 schema and migrations, store SQL, HTTP methods, Worker routes, enrollment, telemetry, webhook vocabulary, page budgets and cursors, `VIEWER_READ_METHODS` (still exactly five), Recall and handoff packet surfaces.

**Candidate commits (local on `main`, not pushed):** `b18a536`, `bb007c7`, `d7addb2`.

## 2. Baseline (§2)

The baseline was captured from a **clean git worktree at tag `v1.18.0`**: the six pinned product files are byte-identical to the tag, and package version was `1.18.0` (`baseline/PIN.md`, `baseline/served-state/seed-log.txt`). All four contract §2 gaps reproduce; the reproduction evidence is in `baseline/GAP_PROBES.md`:

1. truncated source pages with no coverage metadata — **reproduces**;
2. accepted `needsReview` decisions absent from both attention lists — **reproduces**;
3. a team cue for another participant's task while the caller can write (write probe allowed, recorded actor preserved) — **reproduces**;
4. a complete returned page with an unassigned open task and empty attention lists — **reproduces**.

**Scenario repair v2 (dated).** While authoring the key, the lab workspace was found to give both participants nonempty attention lists, so H4's "does not interpret an incomplete empty list as team completion" clause had no direct observation in the single trace workspace. The lab proposal was removed **before any candidate result or human trace existed**; the contract §4 case set does not require a proposal. The v1.18.0 baseline was then re-produced fresh against the repaired fixture (`baseline/SCENARIO_REPAIR.md`). Nothing was rescored.

**Key correction (dated).** Evidence verification found one authoring error: the key's Ben/lab `suggestedNextAction` cell claimed the oldest-open fallback while the frozen (unchanged) precedence prefers the `unassigned_blocked_task` cue. Corrected in `SCENARIO_KEY.md` with a dated note, before any scored trace; no cue expectation, H item, or D threshold changed.

## 3. Deterministic checks D1–D6 (§5)

`tests/integration/att-001.test.ts` — 23 tests, all passing on the recorded candidate. Run record: `npm run typecheck` clean; focused suite 23/23; full suite **88 files / 1101 tests passed**; `npm run build` clean with `public/` byte-identical (verified with `cmp`).

| Check | Required property | Result |
| --- | --- | --- |
| **D1 — coverage truth** | Complete/truncated task and decision combinations produce correct `attentionCoverage`; the rendered attention panels distinguish complete-empty from incomplete-empty and never show an unqualified all-clear; nonempty lists carry the qualification through the real `renderOrientation` wiring. | PASS |
| **D2 — review source fidelity** | Exactly the returned accepted `needsReview` decisions get cues with correct ids and cited non-current finding ids; current-citation, plain, competing, superseded, and proposed decisions get none; the cue is never in `needsYou` or `suggestedNextAction`. | PASS |
| **D3 — authority separation** | Assignment, `needsYou`, and `needsAttention` do not change `canAct`; viewer-assigned demotion leaves the write denied; a writing participant takes up a teammate task with their own provenance; unauthorized and wrong-workspace reads leak nothing. | PASS |
| **D4 — decision safety** | Acceptance, needs-review, proposal, supersession, and recorded replacement stay distinct; the cue carries no operative-decision fields; competing accepted decisions keep both accepted; the decoration is read-time only. | PASS |
| **D5 — surface parity and accessibility** | Sync and async services agree on ids, reasons, and coverage; MCP JSON carries coverage and the cue; CLI JSON/text align; the Viewer renders plain labels, the coverage line, the cited ids, and the assignment note as text. | PASS |
| **D6 — boundedness and compatibility** | Five Viewer read methods unchanged; MCP tool set and input schema unchanged; slices, cursors, and budgets unchanged; legacy response fields intact; rendering issues no fetch; no store/schema/migration change. | PASS |

**Release-shaped checks (tooling only; the candidate is not release-shaped).** `npm run pack:tarball` produced the Darwin ARM64 archive from the candidate tree at the unchanged package version `1.18.0` (gitignored `release/`); `npm run deploy:dry-run` passed with the placeholder-free path. Neither produces nor implies a release.

## 4. Independent verification

Two independent verifier agents reviewed the candidate without trusting the builder's report; a third focused re-verification ran after the fixes.

- **Code verification (commit `bb007c7`).** Scope was exactly the 14 intended files; no schema/store/migration change; coverage adds no store call (proxy call-count probe identical to the baseline commit); the cue filter, placement, and suggested-action independence were confirmed by reading the diff; sync/async parity confirmed; Viewer diff render-only with `esc()` on all new interpolations; MCP tool list unchanged. Gates reproduced: typecheck clean, focused 20/20, full 88/1098, build clean, `public/` sync OK. Five mutation checks were run: removing the cue (killed), forcing `completeUnderRules: true` (killed), and adding the cue to `needsYou` (killed) all failed tests; **two survived** — admitting proposed decisions into the filter, and reverting the Viewer attention wiring. Falsification probes passed: unauthorized read leaks nothing; the Viewer allowlist rejects every non-listed method; MCP carries coverage and the cue.
- **Fixes (commit `d7addb2`).** The two survivors were closed with focused tests (a proposed decision citing a stale finding gets no team cue; `renderOrientation` is driven end-to-end for incomplete-empty, complete-empty, and nonempty-with-coverage states), and the test-only two-argument row-renderer seam was removed.
- **Focused re-verification (`d7addb2`).** Re-ran both previously surviving mutations expecting failures, plus gates and candidate-evidence hashes. Result: see the addendum in `docs/evidence/att-001/README.md` / below.
- **Evidence verification.** Baseline SHA256SUMS 69/69 OK; candidate SHA256SUMS OK; the six pinned hashes re-derived from tag `v1.18.0`; every gap claim and quoted capture line re-checked; the key cross-checked field-by-field against the fixture and all ten candidate dumps — no missed cue, no false cue, no counterexample cue, no beyond-page cue; human materials contain no key facts; scenario-repair story consistent; sanitization clean (only assertion literals and documentation mentions); a fresh seed+dump reproduced the candidate served state byte-for-byte across all 24 files.

Addendum (`d7addb2` focused re-verification). Both previously surviving mutations were re-run in a detached worktree and are now killed: admitting `proposed` decisions into the cue filter fails the D2 proposed-decision test (exact received mutant cue shown by the verifier), and reverting the `renderOrientation` attention wiring fails the two D1 wiring tests. Gates on `d7addb2`: typecheck clean, focused 23/23, full suite 88 files / 1101 tests, `public/app.js` byte-identical to `src`. The 66-entry candidate `SHA256SUMS` verifies cleanly.

## 5. Human observation (§6)

**NOT OBSERVED.** The controlled trace requires two different people (at least one not the builder); the engineering session had one operator, and §6 forbids substituting agents or the builder. The frozen materials are ready:

- `docs/evidence/att-001/PARTICIPANT_PACKET.md` — six neutral prompts, session rules, counterbalanced perspective order (P1 My work first, P2 Team work first), recorder checklist; no key facts.
- `docs/evidence/att-001/SCORING_FORM.md` — H1–H6 PASS/FAIL/NOT OBSERVED sheets, H3/H4/H5 safety second review, D1–D6 matrix, verdict cover sheet.
- `docs/evidence/att-001/TRACE_RUNBOOK.md` — turnkey seed → two actor-bound Viewers → `whoami` → source position → session → score → reset, with the exact actor ids and token keys.
- `docs/evidence/att-001/SCENARIO_KEY.md` — the restricted answer key.

The trace shows whether two people understood this frozen case; it cannot close Gate B, C, E, or F, and it is not causal improvement over v1.18.

## 6. Labeled rehearsal (debug only — not evidence)

A fixture-only subagent rehearsal walked the participant packet against the candidate Viewer text captures for both counterbalanced sessions (Ana: My work → Team work; Ben: Team work → My work). Rehearsal score against the key: **12/12 item-level passes**, including H3/H4/H5. Recorded frictions, none a safety failure and none requiring a product change: two flagged decisions exist while the packet says "which one"; a human owner's own agent's blocked task is labeled "another participant" on Team work (accurate to the caller-identity split, but a wording observation); the bounded read shows the omitted task, superseded decision text, and cited findings as IDs only (drill-down exists); the needs-review flag's suspension semantics rely on the visible `accepted` status plus the absent replacement/retirement record.

Per contract §6 this rehearsal **cannot substitute for a human answer** and is recorded only as engineering preparation.

## 7. Deviations, limitations, and notes

- **No human trace** (§0, §5): the central comprehension claim is unmeasured; the verdict is the contract's engineering-candidate disposition.
- **Scenario repair v2 and key correction** are dated and applied before any scored trace; no participant had read the key; nothing was rescored.
- **Rehearsal class**: the rehearsal is a single-operator/subagent debug run, not C/H evidence.
- **Known pre-existing delta, not touched**: the async service's `currentWork.acceptedDecisions` ordering differs from the sync service's explicit sort (a v1.18.0-era discrepancy); ATT-001 did not change it, and it does not affect attention cue membership.
- **Cue order** within `needsAttention` is the returned decision-page order; the key treats order as non-normative beyond the existing categories.
- **CLI labels**: stable Sprint 008 reason codes are preserved and the human-readable gloss is added for the new review reason only; the Viewer carries plain-language labels for all cue reasons.
- **Baseline worktree limitation**: the capture worktree was discarded after capture, so byte-identity is verified as "every recorded hash equals the tag hash" rather than by re-running that exact worktree.
- **Single machine**: all evidence was produced on the repository machine; the fixture requests no live harness credentials.

## 8. Open gates and next steps

- Run the eligible two-person controlled comprehension trace with `TRACE_RUNBOOK.md` and score it with `SCORING_FORM.md`; only that can move ATT-001 to GO or a NO-GO/REFRAME finding. A repair requires a fresh trace.
- Gate B, Gate C, Gate E, Gate F, VIS-001 condition 4, the WCO-001 two-human case, and the SWH-001 observations remain open and untouched.
- v1.19.0 publication, tag, installer pins, or deployment require a **separate release decision** after this record; none is requested by this document.
- Notifications, controlled requests, and agent coordination remain out of scope and require a later contract and Gate F evidence.
