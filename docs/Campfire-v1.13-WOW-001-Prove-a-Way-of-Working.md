# Campfire v1.13 — Prove a Way of Working

**Sprint ID:** WOW-001

**Target release:** v1.13.0

**Status (October 8, 2026):** Delivery surfaces implemented and all six pilot
arms executed; independent scoring and the verdict are pending in
`docs/SPRINT_WOW_001_RESULT.md`. This contract fixes the one playbook, its two
delivery surfaces, the baseline, the rubric, and the pilot pass criteria.

**Depends on:** CTX-001 / v1.10.0; COR-001 / v1.11.0; VIS-001 / v1.12.0 (CONDITIONAL)
**Theme:** One measured `incident-investigation` workspace playbook

**Sequencing decision, October 7, 2026:** The founder chose implementation first and the exact harness/model lock later. The scenario bundles and scoring rubric were committed before implementation. The environment lock (`fixtures/incidents/wow-001/RUN-LOCK.md`) and the sealed-key isolation demonstration (`docs/evidence/wow-001/`) were committed before any pilot run; implementation alone was not pilot evidence. The six arms were run on October 8. Their scoring is pending.

---

## 1. Sprint question

> Does one `incident-investigation` playbook produce better-recorded work and a more reliable handoff than the same work done without it?

v1.10 bounded orientation and catch-up. v1.11 made corrections and decision replacement explicit. v1.12 made that state visible, with usability unverified. The roadmap's v1.13 direction is one workspace playbook, measured, expanding only on evidence (`docs/ROADMAP.md:1460-1463`). A playbook is guidance for how to record useful state. It is not workflow execution and not new domain machinery (`docs/ROADMAP.md:1493`). The experiment is the deliverable; the playbook text and its two read-only surfaces exist to run it.

The experiment measures the two outcomes the roadmap names: recording quality and continuation quality (`docs/ROADMAP.md:1462`). It does not test whether Campfire needs a workflow engine, a skills platform, or more than one playbook.

## 2. Entry conditions and evidence boundary

| Condition | Current record | Effect on this sprint |
| --- | --- | --- |
| v1.10 orientation and currentness exist | v1.10.0 shipped | Prerequisite met. Reuse bounded `get_workspace_context` and catch-up; add no new retrieval. |
| v1.11 correction semantics exist | v1.11.0 shipped, CONDITIONAL GO | Prerequisite met. The playbook uses `correct_finding`, `withdraw_finding`, `accept_decision`, and `retire_decision`; it adds no transition. |
| v1.12 Viewer comprehension | v1.12.0 shipped, CONDITIONAL; no human trace on the shipped surface yet | Run the human Viewer comprehension trace now, in parallel. This sprint neither blocks on it nor claims it. |
| Artifact-open observation (VIS-001 condition 4) | Open. Review by October 14, 2026 | Parallel. If no opportunity occurs, scope the read-only Viewer reference affordance as an observation tool. Previews stay deferred. |
| CLI decision-ordering inconsistency | Open; tracked separately | Out of scope. Fix without assigning operative status by position. |
| Pre-registration | Scenario bundles, ground truth, prompts, applicability matrix, and rubric committed before implementation; implementation commit `977c0e3`; dated run lock committed in `fixtures/incidents/wow-001/RUN-LOCK.md`; sealed-key isolation demonstration committed in `docs/evidence/wow-001/` | Frozen. The playbook definition and environment are frozen; record any post-freeze deviation rather than hiding it. The six arms executed October 8; scoring is pending. |

Six runs are pilot evidence. They do not establish Gate B, Gate C, Gate D, Gate E, Gate F, or Gate G. The v1.12 human trace and artifact observation are separate v1.12 evidence; this sprint must not absorb their outcomes, and they must not be credited to this sprint.

## 3. Smallest product journey

1. The three scenario bundles, ground truth, task prompts, applicability matrix, and rubric were committed before implementation. Before any run, freeze the implemented playbook definition and commit the exact harness/model environment lock and sealed-key isolation demonstration.
2. For each run, a fresh workspace is created and a first agent receives the scenario prompt for its arm. The agent investigates with its normal harness and records the investigation through existing CLI/MCP operations.
3. The first agent stops. The record is frozen. No manual cleanup or preparation for the next agent occurs.
4. A fresh second agent session, with no private transcript or scenario files, reads only the authorized workspace and answers the continuation questions.
5. Scorers apply the recording rubric to the workspace and the continuation rubric to the second agent's answers, blind to arm where feasible.
6. The result records scores, deviations, whether the playbook was fetched, and the pre-registered pass criteria outcome.

## 4. Product and interface contract

### 4.1 The `incident-investigation` playbook

The playbook is static, harness-independent guidance for recording an incident investigation so that a later person or agent can continue it from authorized workspace state alone. It adds no domain object, no lifecycle, and no write path. The shipped text must express these stages and rules; wording may change only before the first run.

1. **Frame.** Reuse the incident goal or create one. Record the symptom as a finding: `summary` states the user-visible failure; `detail` states impact, affected surface, start and latest observed time, and scope. Register the alert, log excerpt, or report as an artifact and cite it as evidence. Never state a cause in the symptom finding.
2. **Facts.** Record each observed fact as its own finding as it is learned. `detail` carries the observation time and the exact signal. Cite evidence promptly, using a follow-up citation call when the create operation cannot attach it. Do not merge inference into a fact.
3. **Hypotheses.** Record each hypothesis as a finding with `confidence` and a `detail` that states what would confirm or refute it. A hypothesis is never stated as fact. Record the step that tests it as a task; record the result as a new finding or a correction.
4. **Corrections.** When a recorded fact or hypothesis is wrong, correct or withdraw it through the existing path with a reason. Never silently overwrite and never leave a refuted hypothesis current. To replace a decision, propose a new decision with `replacesDecisionId`; accept it only after explicit authorized approval, with a reason. Retire a choice through `retire_decision` with a reason.
5. **Converge.** Record the cause as a finding with confidence and cited evidence. If the evidence is inconclusive, say so explicitly and record what remains unknown and what test would resolve it. Never present an uncited cause as fact.
6. **Decide.** Propose the response as a decision with rationale and basis citations. Acceptance requires explicit approval from an authorized actor; the playbook must never tell an agent to approve its own proposal automatically. A replacement names its predecessor and, if accepted, records the reason.
7. **Leave it continuable.** Record follow-up work as tasks with assignees where known. Check that the workspace answers: what happened, what is believed, what response is proposed or approved, what is next, what is uncertain. Do not paste transcripts or unrelated conversation into state.

Cross-cutting rules: one statement per finding and one choice per decision; register evidence and cite it promptly through the available operations; distinguish observation, inference, and choice; record the acting identity and session honestly; keep uncertainty visible. `needsReview` remains a read-time result and is never faked.

### 4.2 Recording schema

| Incident element | Campfire object | Required content | Existing operation |
| --- | --- | --- | --- |
| Symptom | Finding | Observed failure; impact, surface, time window, scope; cited evidence artifact | `add_finding`, `add_artifact`, `cite_finding_evidence` |
| Observation or fact | Finding | Fact; time and signal; evidence citation | `add_finding`, `cite_finding_evidence` |
| Hypothesis | Finding | Hypothesis; `confidence`; confirmation/refutation test; task if it needs work | `add_finding`, `create_task` |
| Refuted or incorrect record | Finding transition | Correction or withdrawal reason | `correct_finding`, `withdraw_finding` |
| Cause | Finding | Cause or explicit uncertainty; `confidence`; evidence citations | `add_finding`, `cite_finding_evidence` |
| Response | Decision | Proposed choice; rationale; basis citations to relevant findings, whose evidence cites artifacts; accepted only on explicit authorized approval | `add_decision`, `cite_decision_basis`; `accept_decision` only after approval |
| Replaced or withdrawn choice | Decision transition | `replacesDecisionId` on the new proposal; approval or retirement reason | `add_decision`, then `accept_decision` only after approval; or `retire_decision` |
| Investigation step | Task | Title; status | `create_task`, `update_task` |
| Follow-up | Task | Title; open status; assignee where known | `create_task` |
| Evidence bundle | Artifact | Type, title, reference, metadata | `add_artifact` |

The minimum retrievable incident record, used by the rubric, is: one symptom finding with evidence; at least three distinct observational findings with citations; at least one first-agent-authored hypothesis with confidence and a test; a cause finding or an explicit inconclusive statement with citations; one proposed or properly approved decision with rationale and basis; follow-up tasks; an artifact record for each referenced evidence item; intact provenance; no uncited assertion of cause; no transcript pasted into state. Pre-seeded S2 state cannot earn recording credit by itself. The fixtures must each contain at least three independently observable signals, a response choice (S3 may choose another diagnostic before remediation), and a hypothesis to test; agents must not invent records to satisfy a count.

### 4.3 Delivery surfaces

**One shared definition.** `src/playbooks/incident-investigation.ts` exports a versioned, typed definition and `src/playbooks/index.ts` is the registry. It contains no workspace data and requires no model. The detail result on both surfaces is the same object: `{ kind: "campfire_playbook", schemaVersion: 1, name: "incident-investigation", version: string, stages: [...], rules: [...] }`. A parity test compares the parsed CLI JSON value with the parsed MCP text result, not their whitespace.

**CLI.** Add a read-only, non-workspace-scoped command `campfire playbook`: `campfire playbook list` and `campfire playbook incident-investigation`, with `auto|human|json` output. It reads the static definition without opening a database or resolving an actor. During this pilot, `CAMPFIRE_PLAYBOOK=1` enables the command and its discovery in help and `campfire capabilities`; with the variable absent, the command is unavailable and is omitted from discovery. Existing manifest entries do not change. This opt-in keeps control runs from obtaining the guidance through a shell.

**MCP.** Add `get_playbook`, read-only, input `{ name: string }`, returning the same structured definition as the CLI JSON. It is registered only when explicitly enabled: `campfire mcp --with-playbook` or `CAMPFIRE_PLAYBOOK=1`. Add `with-playbook` to the CLI boolean-flag parser. Resolve one gate and pass it through local, remote-ready, and remote-unavailable MCP startup; default tool registration and `SESSION_INSTRUCTIONS` remain unchanged. The handler looks up the local static registry directly rather than forwarding an unrecognized method to `/v1/call`; it accepts no workspace ID and performs no workspace authorization because it returns no workspace state. Existing startup identity and token checks still apply. An unavailable remote listener retains its existing unavailable-tool behavior. An unknown name returns a typed `ValidationError`. No MCP resource, prompt, Worker method, or store method is added.

**Rejected alternatives, recorded so they are not re-litigated.** Server instructions would expose the guidance in the baseline arm and contaminate the comparison. A workspace artifact would blur the guidance with the work being measured and vary per run, instead of one versioned definition.

### 4.4 Baseline

- **Arms and estimand.** Control and treatment use the same build. Control has `CAMPFIRE_PLAYBOOK` unset and no `--with-playbook`; verify that both CLI guidance and the MCP tool are unavailable before its run. Treatment has `CAMPFIRE_PLAYBOOK=1` and one availability sentence added to the otherwise identical first-agent prompt, naming `campfire playbook incident-investigation` / `get_playbook`. This comparison estimates the effect of *offering* the playbook. Fetch rate is a separate measure of exposure; do not call an unfetched playbook effective.
- **Scenarios and sealed keys.** Three synthetic scenarios are frozen under `fixtures/incidents/wow-001/`, each with `scenario.md`, `evidence/`, `ground-truth.md`, and `scoring-key.md`. The archetypes are: S1, a clear cause with one response choice; S2, a pre-existing prior-shift false-lead finding in Campfire that later evidence requires correcting or withdrawing; S3, genuinely inconclusive evidence where a justified response is to run another diagnostic before remediation. S2's sealed setup specifies an identical seeded finding and honest fixture provenance in both fresh workspaces; the first agent is not required to make a wrong guess to exercise correction. Stage only the assigned prompt, `scenario.md`, and its evidence in an isolated first-agent working directory. Keep ground truth, scoring keys, the contract, playbook source, other-arm prompts, and prior results outside both agents' accessible context and filesystem. If this isolation cannot be demonstrated, the run is invalid.
- **Runs.** Three scenarios × two arms = six valid runs, each in a fresh workspace and agent session. Before the first run, freeze the exact first- and second-agent prompts, harness/model versions, allowed tools, time and tool-call budgets, stopping rule, and randomized or counterbalanced arm order. Use isolated treatment harness configuration or inherited environment rather than editing generated MCP commands; reload it and verify the tool list. Clear the playbook flag in every control and second-agent session. Match harness/model settings across arms for each scenario; record any mismatch.
- **Handoff.** Stop the first agent under the frozen rule, record the workspace stream tip and a read-only export, and permit no later write to that workspace before scoring. A fresh second agent, matched across arms, receives only a neutral question prompt and authorized Campfire workspace access: What happened? What does the team currently believe the cause is? What is decided, and at what status? What is the next action? What is uncertain or needs review? It receives no first-agent transcript, scenario evidence directory, answer key, or playbook.
- **Contamination and replacement.** Record playbook exposure through MCP, CLI, help/manifest, source, copied text, or accidental key access. A control run with guidance exposure, either arm with answer-key exposure, or a run stopped outside the frozen rule is invalid. Repeat that arm once with a fresh workspace and session, preserving the invalid attempt in the result. If a valid replacement is not possible, the pilot cannot receive GO. Do not quietly reduce the denominator or add an unplanned scenario. Keep every valid treatment run in the offered-arm comparison whether or not it fetched; report fetches separately.
- **Pre-registration.** Freeze prompts, budgets, order, applicability, scoring anchors, and the response to invalid runs before the first run. No rubric, scenario, or playbook-text edit after the first run. Record deviations rather than hiding them.

### 4.5 Rubric and pilot pass criteria

Recording quality, per run, binary items:

| Item | Passes when |
| --- | --- |
| R1 | A symptom finding exists and cites at least one evidence artifact. |
| R2 | At least three independently supported observations are recorded as findings, each citing evidence with a time or signal; rewordings of one signal do not count. |
| R3 | The first agent records at least one hypothesis with `confidence` and a stated test, without asserting it as fact; a pre-seeded S2 hypothesis alone does not pass. |
| R4 | Where the scenario contains a false lead, the refuted record is corrected or withdrawn through the existing path with a reason. |
| R5 | The cause finding, or an explicit inconclusive statement, is recorded with `confidence` and cited evidence. |
| R6 | A response choice is recorded as a proposed or properly approved decision with rationale and cited basis. S3 may choose another diagnostic while leaving the cause unresolved. |
| R7 | The decision's status is honest: no agent automatically accepts its own proposal; any acceptance follows explicit authorized approval and records the required transition and reason. |
| R8 | Follow-up tasks are recorded and open where the scenario requires action. |
| R9 | Provenance is intact: acting identity and session attribution present; no transcript pasted into state. |
| R10 | Every referenced evidence item has an artifact record; no cause is asserted without a citation. |

Continuation quality, per run, binary items:

| Item | Passes when |
| --- | --- |
| C1 | The second agent names the incident symptom correctly. |
| C2 | It states the cause or the recorded uncertainty without overstating it. |
| C3 | It identifies the incident response decision, rationale, and actual status; it does not treat a proposal or retired/superseded choice as operative, or select one of several accepted decisions as operative absent an explicit replacement. |
| C4 | It names the next action from the recorded tasks. |
| C5 | It reports at least one uncertainty or review flag present in the record, where one exists. |
| C6 | It cites at least one Campfire object for its claims. |
| C7 | It does not assert state absent from or contradicted by the workspace. |

The frozen applicability matrix is: R4 applies only to S2; C5 applies only to S3, where uncertainty must be recorded. R1–R3, R5–R10, C1–C4, and C6–C7 apply to all three scenarios. An item marked N/A is excluded for both arms of that scenario; no scorer may change applicability after seeing a run. Scoring keys must define what counts as adequate evidence, an honest confidence value, intact provenance, unsupported state, and an accurate decision status. Two scorers first score independently and blind to arm where feasible; preserve both initial scores and resolve disagreement against the frozen key, recording the resolution. A run passes when recording is at least `ceil(0.8 × applicable recording items)` and continuation is at least `ceil(0.7 × applicable continuation items)`.

The pilot supports expansion only when all four conditions hold:

- At least 2 of 3 treatment runs pass both thresholds.
- In at least 2 of 3 valid matched pairs, treatment's normalized fraction (`passes / applicable items`) is at least as high as control on both dimensions and strictly higher on at least one.
- At least 2 of 3 treatment agents fetched the playbook. This is a minimum exposure check, not proof that they followed it; report behavior and fetch rate separately.
- No treatment run fails R9 or C7. A control failure on either item is baseline evidence, not a veto of a safer treatment. Any authorization breach or answer-key leak in either arm invalidates the affected run and requires investigation before a GO verdict. Any replacement run or harness/model mismatch caps the verdict at CONDITIONAL GO even when the numeric criteria pass.

Otherwise the pilot does not support expansion, and the result records why. The pilot never claims Gate B, Gate C, statistical significance, or production readiness.

## 5. Architecture and compatibility

- Keep one shared playbook definition in a harness-independent module. Do not place it in `src/mcp/` or `src/cli/`; both surfaces import the same source.
- Keep MCP handlers thin and read-only for this tool. The playbook carries no workspace data, so it needs no authorization decision; it must never accept or return a workspace ID.
- Default MCP surface, `SESSION_INSTRUCTIONS`, the Viewer read allowlist, and existing CLI manifest entries are unchanged. The experimental CLI entry is visible only when opted in, and the default MCP tool list stays as shipped in v1.12.
- No schema change, migration, store change, webhook change, or telemetry on playbook use. Existing SQLite/D1 parity is untouched.
- The opt-in flag is additive and documented in the `mcp` command usage and notes; the shared environment switch is documented for both surfaces. Existing `campfire mcp` behavior without either switch must be byte-identical in tool registration. `get_playbook` is served from the local static registry in remote and local MCP modes, without bypassing the existing startup identity/token checks or adding an HTTP method.

## 6. Acceptance scenarios

### Deterministic and security checks

- Without `--with-playbook` / `CAMPFIRE_PLAYBOOK=1`, `get_playbook` is absent, the CLI playbook command is unavailable and omitted from help and `campfire capabilities`, and default server behavior is unchanged. With the switch, exactly one read-only MCP tool and one CLI command become available.
- With `CAMPFIRE_PLAYBOOK=1`, `campfire playbook incident-investigation --output json` and the MCP tool return the same parsed versioned object from the shared module; the parity test fails on divergence. Human and JSON CLI modes and unknown-name failures follow the existing CLI contract.
- The playbook contains no workspace records, credentials, or instruction to perform an unauthorized write. Calling either surface has no automatic write side effect: no contribution, append position, or store change.
- An unknown playbook name returns an explicit typed error on both surfaces; it never returns an empty or partial playbook.
- `campfire capabilities` lists the new command only when enabled; catalog/handler parity tests pass; the CLI compatibility audit remains additive-only.
- Existing Viewer keyboard use, read allowlist, CLI JSON modes, and MCP authorization behavior are unchanged.

### Pilot measurement evidence

- Preserve evidence under `docs/evidence/wow-001/` following the sanitization conventions in `docs/evidence/vis-001/README.md`: frozen prompts and applicability matrix, per-run environment and versions, operation summaries, first-agent records or workspace exports and stream tips, second-agent verbatim answers, both scorers' initial per-item scores, resolutions, invalid attempts, and deviations. Keep sealed answer keys away from agent run environments.
- Record per run: scenario, arm, harness and model versions, runtime, workspace ID, tool list and CLI gate check, playbook fetch or other exposure, contamination status, budget use, and any replacement attempt.
- Label synthetic scenarios and fixture identities accurately. Do not call the pilot Gate B or Gate C evidence.

## 7. Non-goals

- No workflow engine, workflow execution, skills platform, automatic playbook generation, or a second playbook. Exactly one playbook is in scope.
- No new domain object, lifecycle, persistence, or store migration. The playbook is static guidance.
- No Recall or context-packet implementation, embeddings, semantic ranking, or cross-workspace memory. If an initial Recall slice follows, it may show competing accepted decisions with their review state but must not claim one is operative.
- No operative-decision selection rule, and no rewrite of historical fixtures. Stale decisions are corrected or retired through Campfire's existing path when real work establishes staleness.
- No agent coordination, capability discovery or registry, ownership, dependencies, handoffs, approvals, ACP gateway, or huddles. Local MCP's tokenless asserted identity must be addressed before any shared gateway or capability work; that is a separate design.
- No Viewer changes, Viewer writes, or artifact previews. The reference affordance, if scoped after October 14, 2026, is an observation tool, not v1.13 scope.
- No gate promotion and no production deployment or release promotion authorized by this contract.

## 8. Execution and result

1. The contract and scenario bundles, sealed ground truth and scoring keys, prompts, applicability matrix, order, budgets, and rubric were committed before implementation. Check fixture validity without exposing keys to pilot agents.
2. Implement `src/playbooks/incident-investigation.ts`, the registry, `campfire playbook`, and the gated `get_playbook`. Add parity, gating, unknown-name, and no-write tests. Commit this implementation before the pilot.
3. Run focused suites, `npm run typecheck`, `npm test`, `npm run build`, and `npm run pack:tarball`. The dated addendum with the exact harness/model settings, the implementation commit, and the demonstrated sealed-key isolation boundary is `fixtures/incidents/wow-001/RUN-LOCK.md`; the boundary evidence is `docs/evidence/wow-001/`. The shared playbook definition is frozen at that point.
4. Run the six-valid-run pilot with fresh workspaces, matched arms, isolated agent inputs, and frozen materials. Preserve invalid attempts and replacements as evidence.
5. Score, then write `docs/SPRINT_WOW_001_RESULT.md` with the pilot verdict, observed versus fixture evidence, deviations, contamination, and explicit non-claims. Update canonical docs only where the result warrants it.

This implementation does not mark any pilot or release gate complete or authorize release promotion or production deployment.

## 9. GO / CONDITIONAL GO / NO-GO

**GO:** The pilot ran as pre-registered on frozen scenarios and rubric; all expansion criteria are met; no treatment provenance or fabrication failure or unresolved authorization/answer-key breach occurred. A GO supports a founder decision about whether to broaden playbooks; it does not itself authorize a second playbook, a gate, or a deployment.

**CONDITIONAL GO:** The pilot ran with a recorded gap, such as a harness or model mismatch across arms, a valid replacement after an aborted attempt, non-blind scoring, low playbook fetch rate, or a mixed result where recording improves but continuation does not. Record exactly what is unproven and do not expand.

**NO-GO / REFRAME:** The playbook arm does not beat the baseline; the playbook encourages false certainty, uncited causes, or transcript pasting; a provenance or authorization failure occurs; the playbook needs out-of-scope machinery to be useful; or the six runs cannot be completed for a structural reason. Reframe before another pilot.

Gate B (repeat usage) and Gate C (multi-participant value) remain separate measurements. A pilot pass is not a gate. The six runs are pilot evidence, not ordinary team value.
