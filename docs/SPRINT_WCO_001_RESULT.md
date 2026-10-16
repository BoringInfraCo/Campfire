# Campfire — Sprint WCO-001 Result: Continue the Work

**Date:** October 15, 2026

**Status:** **CONDITIONAL GO — engineering candidate.** The eligible two-human
case is **NOT OBSERVED** (recorded reason below); a bounded §4.2 repair
(Amendment 1) passes the D1–D6 deterministic checks on the recorded candidate.
The founder subsequently directed a public v1.18.0 release under a recorded
release-scope override; see `docs/RELEASE_V1_18_DECISION.md` (published and
deployed as `v1.18.0`; the override is not a GO and does not change this
verdict). This record does not claim human continuation, Gate B, Gate C,
Gate E, or VIS-001 condition 4, and does not rescore any earlier sprint.

**Contract:** `docs/Campfire-v1.18-WCO-001-Continue-the-Work.md` (Amendment 1,
October 15, 2026)
**Evidence:** `docs/evidence/wco-001/`
**Baseline:** `docs/evidence/wco-001/BASELINE_V1_17.md`

## 0. Verdict and what it does not claim

Contract §8: **CONDITIONAL GO — engineering candidate** applies when "a bounded
§4.2 repair passes D1–D6, but an eligible post-repair human case is unavailable
for a recorded reason". That is exactly this case:

- **Recorded reason for the missing human case:** no two-human/two-harness pair
  was available in the engineering session (contract §4.1: "If no eligible team
  or task is available, record **not observed** and continue only with
  engineering preparation. A simulated pair is a rehearsal, not the sprint's
  human result"). The witness for the amendment was a labeled single-operator
  rehearsal, not a C1–C7 case.
- **C1–C7: NOT OBSERVED.** No eligible case was opened. The rehearsal
  (`REHEARSAL.md`) produced zero sprint observations.
- The repair is a guidance/schema change; it does not claim that team
  continuation now works. A fresh dated case is required to score that.
- No version bump, tag, public snapshot, installer pin, or deployment is part
  of this result.

## 1. What is in the tree

Product change (Amendment 1, guidance and schema documentation only):

- `src/domain/types.ts` — `FINDING_EVIDENCE_RELATIONS = ["supports",
  "contradicts"]` exported as a value; the type derives from it.
- `src/domain/correction.ts` — `assertEvidenceRelation` validates against the
  shared constant (same accepted set as before).
- `src/mcp/tools.ts` — `cite_finding_evidence.relation` and
  `correct_finding.evidence[].relation` are `z.enum` of the shared constant;
  the citation description states the closed vocabulary; the
  `get_workspace_context` description explains `needsYou` vs `needsAttention`
  ("attention ordering, not an access boundary").
- `src/mcp/instructions.ts` — one added session sentence: needsAttention is
  attention ordering, not an access boundary; a blocked/open task assigned to
  another participant is shared work a writing participant may take up with
  `update_task`, recorded with their own provenance.
- `src/service/service.ts` — the inaccurate `needsAttention` doc comment is
  corrected (team records not actionably assigned to the caller; ordering, not
  access).

Tests: `tests/integration/wco-001.test.ts` (D1–D6, 14 tests).

Evidence and records:

- `docs/evidence/wco-001/README.md` — index, consent/minimization, limits.
- `docs/evidence/wco-001/BASELINE_V1_17.md` — shipped source hashes and surface
  behavior; human case NOT OBSERVED.
- `docs/evidence/wco-001/REHEARSAL.md` — rehearsal run, observed frictions,
  confounds.
- `docs/evidence/wco-001/TRACE_RUNBOOK.md`, `SCORING_FORM.md` — frozen
  materials for the eligible case.
- `docs/evidence/wco-001/served-state/*.json` — frozen orientation captures.
- Contract Amendment 1 (dated, appended; §4.1 unchanged).

**Not changed:** `deriveOrientation` / `deriveSuggestedNextAction`, attention
reason labels and ordering, the CLI, the Viewer (`VIEWER_READ_METHODS`
unchanged; no write, no new read, no fetch), HTTP methods, Worker behavior,
database schema (SQLite or D1), webhook vocabulary, telemetry, Recall/packet
surfaces, enrollment. No migration.

**Candidate pin:** commit `e3fda9e6da382bd9457aa9c1c688a425cfb96924` ("WCO-001: state
teammate-task availability and close the evidence vocabulary"), on the v1.17.0
line (`2b98c752531116654871d285142a55a7441ab665`). Baseline record was written
before this change; no product code changed before the rehearsal.

## 2. Baseline (§4.1)

The first continuation attempt ran the shipped product source: tag `v1.17.0` =
commit `2b98c75…`, package `1.17.0`, with
`git diff v1.17.0 -- src tests public fixtures migrations` empty. Exact file
hashes, surface inventory, enrollment path, and the not-observed human-case
status are in `BASELINE_V1_17.md`. The attempt ran on an isolated database
(`.campfire/traces/wco-001/`) with its own serve process; no user workspace was
seeded or modified.

## 3. Frozen position and the rehearsal witness

The rehearsal's frozen key (task, finding, decision, artifacts, blocker,
expected safe outcomes, source cursor) is summarized in `REHEARSAL.md` §2 and
preserved in `served-state/pre-b-agent-b-context.json`. The rehearsal completed
an A → B → A loop with four distinct actors and 26 recorded contributions. Two
frictions were witnessed and became Amendment 1:

1. A cold teammate's only actionable work was a teammate-assigned `blocked` task
   that appeared solely in `needsAttention` (`team_blocked_task`) with
   `needsYou: []` and `suggestedNextAction: none`; the participant reported the
   work was unambiguous "only because the task description explicitly delegated
   the step" — hand-prepared prose rather than recorded guidance.
2. `cite_finding_evidence.relation` / `correct_finding.evidence[].relation`
   declared a free-form string while the service accepts only
   `supports|contradicts`; the first citation attempt failed validation.

The rehearsal is **not** counted as C1–C6 evidence; it is engineering
preparation, and its confounds (same harness for both agents, one operator,
instruction-based filesystem isolation, wrapper-hidden schemas) are recorded in
`REHEARSAL.md` §6.

## 4. Deterministic checks D1–D6 (§7)

`tests/integration/wco-001.test.ts` — 14 tests, all passing on the candidate:

| Check | Required property | Result |
| --- | --- | --- |
| **D1 — authorization** | Guidance is truthful: a writing teammate can take up another agent's task and the write is recorded; unregistered agents, non-participants, and viewer-role participants are still denied. | PASS |
| **D2 — identity and provenance** | Update and reassignment preserve distinct actors, agent sessions, the original author, and historical Contributions. | PASS |
| **D3 — source fidelity** | One closed vocabulary in the domain validator, the exported constant, and the MCP schemas (exact enum); orientation output identical to the shipped projection; the tool description names the ordering semantics. | PASS |
| **D4 — boundary parity** | The Workers/D1 async code path rejects non-vocabulary relations and accepts `contradicts`; its orientation matches the local projection on the same store. Exercised through the async store proxy over the local store (as the existing worker tests do); no real D1 instance was run, and no store/schema/harness code changed, so migration parity risk is nil. | PASS |
| **D5 — interface safety** | Viewer allowlist still exactly `whoami, list_workspaces, get_workspace, get_workspace_context, get_activity`; MCP tool list unchanged (36); instructions carry no credential/URL material. | PASS |
| **D6 — compatibility** | Previously valid end-to-end citations (`supports`), corrections with evidence (`contradicts`), and the CLI command catalog (59) remain valid. | PASS |

Run record: `npm run typecheck` clean; `npm test` full suite **87 files / 1078 tests passed** (exit 0); `npm run build` clean. Packaging and deployment dry-runs were **not** run: they belong to a release-shaped candidate, and no version bump, tag, public snapshot, installer pin, or deployment was authorized or warranted (contract §8).

## 5. Independent verification

Two independent verifier agents reviewed the candidate without trusting the
builder's report. Both returned **clean**.

- **Code verification.** Full uncommitted diff reviewed: only the five named
  product files plus docs/tests changed; `deriveOrientation`,
  `deriveSuggestedNextAction`, attention reason labels, `src/viewer/**`
  (including the allowlist and static app), `src/http/**`, `src/cli/**`,
  `src/worker/**`, `src/store/**`, and `migrations/**` untouched. The verifier
  independently ran `npm run typecheck` (clean), the six focused suites (126
  tests), and the full suite (87/1078, exit 0). Three mutation checks bit:
  removing the new instruction sentence failed D1; restoring
  `relation: z.string()` failed D3; reverting the tool-description phrase failed
  D3. Falsification probes confirmed the service validator's accepted set is
  unchanged, `z.enum` rejects only out-of-vocabulary values, no tool was
  added/removed, and the Viewer allowlist is untouched.
- **Evidence verification.** All 14 baseline hashes recomputed from `git show
  v1.17.0:…` matched; the archive checksum and the archive-vs-tag viewer asset
  comparison were independently reproduced; the trace database re-derived all
  26 contributions row-for-row against `REHEARSAL.md` §3, the actor/session
  stamping, and the frozen `needsYou` / `needsAttention` / `suggestedNextAction`
  claims; the sanitization scan found no credential-shaped strings or absolute
  home paths in committed evidence; contribution count (26) and test count (14)
  matched.
- **Post-review adjustment (recorded).** From the code verifier's note that the
  guidance sentence omitted the agent session gate, one clause was added:
  "(an agent must have registered a session first)". The two D1-asserted
  substrings are unchanged; typecheck, the focused suites, and the WCO file were
  re-run green after the adjustment.
- **Notes kept visible (not defects).** The HTTP and Worker dispatch tables
  retain their pre-existing local `EVIDENCE_RELATIONS` copies; the amendment
  unified only the domain validator and the MCP schemas, and all four agree
  today. Historical emptiness of the baseline diff is inferred from the
  docs/packaging-only commits between the tag and HEAD, since no ref captured
  the attempt-time worktree.

## 6. Deviations, limitations, and notes

- **No eligible human case.** The sprint's central claim remains unmeasured
  (§0). The next eligible attempt must be a new dated case per §6; the rehearsal
  is not its baseline or its result.
- **Witness class.** Amendment 1 was justified by a labeled rehearsal. The
  repair is deliberately minimal (guidance, one closed vocabulary, one doc
  comment) precisely because the witness cannot carry a human claim.
- **No selection-rule change.** `deriveOrientation` /
  `deriveSuggestedNextAction` and the attention reason labels are unchanged;
  the witnessed need was truthful guidance, not a new rule. Sprint 008/009
  precedence tests still pass.
- **Confounds** are listed in `REHEARSAL.md` §6; the decisive B facts came from
  authorized Campfire reads, not from A's transcript or a recap.
- **Reference-open:** Agent B opened the stored archive reference during the
  rehearsal; because the run is a rehearsal, it is not eligible evidence for
  VIS-001 condition 4.
- **Runbook corrected after review (October 15, 2026).** The first
  `TRACE_RUNBOOK.md` draft described creating a fresh workspace via `onboard`,
  which conflicts with contract §4.1's requirement to use an existing
  ordinary-work workspace and task. It now requires a pre-existing workspace
  with a real task dependency, enrolls only the second pair through the
  invitation path, forbids creating case records, and records the case
  **not observed** when no eligible task exists. No case had been run, so
  nothing is rescored.
- No Gate E claim arises from this sprint.

## 7. Open gates and next steps

- Run the eligible two-human/two-harness case with `TRACE_RUNBOOK.md` and score
  it with `SCORING_FORM.md`. Only that case can move WCO-001 to GO (or the
  contract to NO-GO / REFRAME).
- Gate B, Gate C, and Gate E remain unmeasured; VIS-001 condition 4 and the
  v1.17/SWH-001 human observations remain open and are untouched by this
  result.
- Any v1.18 release decision is separate and none is requested by this record.
