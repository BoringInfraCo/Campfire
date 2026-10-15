# Campfire — Sprint SWH-001 Result: Shared Work Home

**Date:** October 14, 2026

**Status:** Implemented engineering candidate (pinned `d7e3b62`). D1–D7 deterministic checks pass. The two-human controlled comprehension trace and the ordinary-work observations are not yet scored, so the candidate is **UNSCORED** — not GO and not CONDITIONAL GO. The founder subsequently authorized a bounded public release under a recorded release-scope override; see `docs/RELEASE_V1_17_DECISION.md` (published and deployed as `v1.17.0`).

**Contract:** `docs/Campfire-v1.17-SWH-001-Shared-Work-Home.md`
**Evidence:** `docs/evidence/swh-001/`
**Fixture:** `fixtures/swh-001/`

## 0. Verdict and what it does not claim

The v1.17 slice is implemented in the existing read-only Viewer as a bounded rearrangement of already authorized `get_workspace_context` data: one home with **My work** and **Team work** perspectives, a shared decision boundary, bounded completeness for every displayed slice, and inert artifact references. The deterministic acceptance matrix D1–D7 from contract §7 passes, including a closing round of mutation checks that proved the new wiring tests fail when the whoami→My-work or perspective→renderer glue is broken.

The contract's §8 verdict cannot be recorded yet. **GO** requires both controlled human participants to pass §7, the overdue shipped-v1.16 Viewer comprehension trace, a real accessible reference-open attempt, and an ordinary two-human/two-agent continuation. **CONDITIONAL GO as an engineering candidate** requires both controlled participants to pass with the other observations unavailable for a recorded reason. Neither human participant has been traced yet, so the candidate is deliberately left **unscored** (§8: "If only one controlled participant is available, keep the candidate unscored until the second trace"). A deterministic test pass is implementation evidence, not a human comprehension result.

This result does not claim Gate B, Gate C, or Gate E, does not close VIS-001 condition 4, does not change the RCL-001/002/003 NO-GO / REFRAME verdicts, and does not authorize publication, tagging, public export, or deployment. The workspace remains the only collection and authorization boundary; the page is not a Contribution and stores nothing.

## 1. What is in the tree

Viewer-only changes, per contract §5:

- `src/viewer/static/index.html` — perspective nav (two native buttons with `aria-pressed`, "My work" / "Team work"), `#orientation[data-perspective]`, a "Shared sources" panel, `p perspective` in the hint line. The two perspective buttons are the only buttons in the shell; the pre-existing journal "older activity" button remains inside the workstream.
- `src/viewer/static/app.js` — perspective state (deterministic `"mine"` default; guarded `localStorage` preference storing only `"mine"`/`"team"`), `setPerspective`, `renderMyWork`, `renderTeamWork`, `renderSources`, and shared decision-boundary rendering. My work leads with the service `needsYou` projection, then tasks assigned to the caller or their participating owned agents (`humanOwnerId` exact match only), with the goal and decision boundary visible. Team work leads with `needsAttention`, then people, their participating agents, tasks grouped by recorded assignee, unowned agents as ownership-unknown, non-participant assignees by actor id/type with an explicit unknown-name state, and unassigned tasks separately. Proposed, accepted, accepted-needing-review, and superseded records carry distinct text labels; `needsReview` and cited non-current finding ids stay visible; replacement links appear only when recorded. Artifact type/title/stored reference render as inert text with "(stored reference, not fetched)". Completeness uses each slice's `total`/`returned`/`truncated`; a complete empty group says "none", a filtered group from a truncated slice says "no matching tasks in the returned N of M; more may exist".
- `src/viewer/static/app.css` — perspective styles (selected state by weight/underline/border, explicit `:focus-visible`), per-perspective panel order/visibility, source rows.
- `public/index.html`, `public/app.js`, `public/app.css` — build-synced copies (`npm run sync:public` inside `npm run build`); `cmp` confirms byte-identical.
- `tests/integration/swh-001.test.ts` — new file: the seven D1–D7 deterministic checks plus three "home wiring" tests (W1–W3). Ten tests total.
- `fixtures/swh-001/seed.ts`, `fixtures/swh-001/dump.ts`, `fixtures/swh-001/.gitignore` — deterministic controlled scenario builder and dump helper.
- `docs/evidence/swh-001/` — baseline, scenario key, participant packet, scoring form, trace runbook, reference-observation status, README, and the frozen served-state dumps.

Not changed: `src/viewer/server.ts`, `src/viewer/generated-workspace-view.ts`, `src/worker/**`, `src/cli/**`, `src/mcp/**`, `src/service/**`, `src/domain/**`, `package.json` (no version bump), the database schema, webhook vocabulary, telemetry allowlist, playbook flag, Recall selection, handoff packet, generated workspace page, and every pre-existing test file. `VIEWER_READ_METHODS` is still exactly `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity`. The browser still holds no token; the home adds no service read, no polling loop, and no new storage beyond the content-free perspective preference.

**Candidate identification (pinned):** commit `d7e3b62b94fe8532c4378361f98bf2871868370f` ("SWH-001: add the read-only Shared Work Home to the Viewer"), on top of the v1.16 source at `db3a121d3cbbc4beed1965ef6956b3294a109c7c`; `src/viewer/static/app.js` sha256 `1ab9c42a70e9377772d446e70f74e78bdd2c28e4095114b789c95071808da632`; `index.html` `74120d2f33dd4e0e8b3c3421fb8d32a45c313c3e38b2ce1120b1552b37fec5dd`; `app.css` `d543d210fa1e9b4b0782c26e2894a2601533274b840f1269a92f1255757c607b`. The trace scoring form records this candidate commit; the frozen scenario and key are independent of the Viewer source.

## 2. v1.16 baseline and open VIS-001 observations (§9.1)

`docs/evidence/swh-001/BASELINE_V1_16.md` records the committed v1.16 Viewer source at HEAD `db3a121d3cbbc4beed1965ef6956b3294a109c7c` ("Record v1.16.0 publication and deployment"), package `1.16.0`, with sha256 values of the four static files read via `git show HEAD:…` (not the working tree).

- **Shipped-v1.16 Viewer comprehension trace: not run before implementation.** Recorded reason: the implementation interval (2026-10-14 UTC) is an agent session; no independent human participant was available. The trace remains owed and must not be relabeled as a v1.16 baseline after the fact.
- **Reference-open observation: not yet attempted.** `docs/evidence/swh-001/REFERENCE_OBSERVATION.md` records VIS-001 condition 4 as **OPEN**. This is a status, not a dated absence — a dated absence requires a real participant's ordinary-work interval in which no attempt occurred. The fixture reference and the Viewer merely displaying it cannot close condition 4.

## 3. Frozen controlled scenario and answer key (§9.2, §6.1)

`fixtures/swh-001/seed.ts` builds a deterministic SQLite workspace and `fixtures/swh-001/dump.ts` writes each human's own served state to `docs/evidence/swh-001/served-state/`. The scenario is labeled **fixture evidence** — it calibrates the UI and rubric and cannot establish Gate B, C, or E.

- Two humans with tokens: `hum_swh001_dana` (owner) and `hum_swh001_rowan` (member); each has a participating owned agent on a different harness: `agt_swh001_codex` (codex, owner Dana) and `agt_swh001_opencode` (opencode, owner Rowan).
- Tasks: `task_swh001_staging_check` (blocked, Dana), `task_swh001_reproduce_failure` (in progress, Dana), `task_swh001_rollback_job` (open, Codex), `task_swh001_review_drill` (open, Rowan), `task_swh001_health_checks` (open, OpenCode), `task_swh001_escalation_owner` (blocked, unassigned), `task_swh001_release_checklist` (open, unassigned), `task_swh001_staging_env` (completed, Dana). Tasks slice complete (8/8). Rowan has zero blocked assigned tasks on a complete slice — the keyed complete-empty case.
- Decisions: `dec_swh001_blue_green` (accepted, `needsReview`, cites non-current `find_swh001_draining_window`) and `dec_swh001_canary` (accepted, conflicting rationale, no recorded transition between them — the keyed safe next step is to seek an explicit retirement or accepted replacement before executing either); `dec_swh001_manual_rollback` superseded by `dec_swh001_automated_rollback` with a recorded reason (replacement links); `dec_swh001_friday_windows` proposed. `historicalCounts` = 1 superseded decision, 1 corrected finding.
- Findings: `find_swh001_draining_window` superseded; `find_swh001_drain_clean` current with evidence on `art_swh001_drill_report`; `find_swh001_health_gate` current.
- Artifacts: 12 total, 10 returned, **truncated** — the keyed truncated section. `art_swh001_runbook_ref` references `docs/ARCHITECTURE.md` (a real repo file; separate access status known accessible); `art_swh001_trace_284` and `art_swh001_pr_284` are external references with known non-independently-accessible status.
- Per-participant `needsYou` / `needsAttention` reasons and source ids are frozen in `docs/evidence/swh-001/SCENARIO_KEY.md` against the served JSON, together with the H1–H7 expected answers and the keyed safe next step.

Verification: three fresh seeds reproduced the served-state dumps byte-for-byte; only token values/hashes and the invisible `schema_migrations.applied_at` wall-clock vary (documented). Frozen hashes: `context-dana.json` `45c9098257b73460eb150f9f5c178cb2700483c1625d955fc368b893e7e381f6`, `context-rowan.json` `728050ebc127b2a8ebb5eeeba7531f4c5155aa5d88021e859b10e82e94ffcd87`, `workspace-dana.json` `23a1d2c763c0b7f2f589eec134e98fd98a02bc0e507400e012109b6faeb1aab6`. No token value or credential-shaped string is committed. `docs/evidence/swh-001/TRACE_RUNBOOK.md` was executed end-to-end: `campfire view --token <token>` binds actor-bound loopback Viewers (Dana on 9415, Rowan on 9416; verified `whoami` outputs), and the served context matches the frozen dumps. The runbook also records that `--actor/--type` alone fails against a machine with an operator profile and that `CAMPFIRE_TOKEN` is the verified equivalent path.

## 4. Deterministic acceptance matrix D1–D7 (§7)

`tests/integration/swh-001.test.ts` — all seven pass:

| Check | Test | Result |
| --- | --- | --- |
| **D1 — authorization** | lists only the bound actor's workspaces and denies every other selection without leakage | PASS — unknown, non-participant, and forged selections are denied service-side with no title/participant/count/reference/activity sentinel |
| **D2 — identity** | shows different My work and Needs You per actor while Team work keeps the same shared facts | PASS — two real actor-bound viewers; owned, unowned, and unknown agents render distinctly; agent-bound callers get only their own assignments |
| **D3 — source parity** | renders statuses, reasons, ids, labels, and completeness exactly as served, in both perspectives | PASS — every displayed status/reason/id/label/count matches the served JSON at one recorded source position; truncation stays incomplete in both perspectives |
| **D4 — read boundary** | keeps the five-method allowlist, writes nothing, and holds no browser token | PASS — allowlist exact; write → 403 before the call; reads add no Contribution; no `Authorization` usage; client methods ⊆ allowlist |
| **D5 — hostile text and reference** | renders markup as inert text, never links or fetches a reference, and keeps the Host boundary | PASS — no live markup, no `javascript:` link, no auto-fetch; bad Host still 403s |
| **D6 — accessibility and compatibility** | exposes both perspectives by keyboard with non-color state and keeps the journal | PASS — `aria-pressed` buttons, `:focus-visible`, text status labels, journal/shell intact |
| **D7 — bounded work** | renders truncated work honestly without fetching and adds no method, poll, or loop | PASS — renderers run with a throwing `fetch`; one interval; truncated workspace shows honest counts |

Supplementary "home wiring" tests W1–W3 pin the whoami→My-work glue, the perspective→renderer selection, and `callerRef` actor-type handling. Mutation checks proved all three bite: forcing `callerRef` to null fails W1 and W3; forcing My work regardless of perspective fails W2.

## 5. Independent verification

Two independent verifier agents reviewed the implementation and the evidence without trusting the builders' reports.

- **Code verification:** full diff reviewed; no forbidden file changed; `npm run typecheck` clean; full suite green at the time of review (86 files, 1061 tests, before the wiring tests were added); `npm run build` clean and `public/` byte-identical; all four initial mutations (creator-as-assignee, truncated-empty wording, artifact anchor, added `api()` call) failed the relevant tests. Falsification attempts found no path where an unassigned task enters My work, a completed task is called active, a task is grouped by creator, a superseded decision is rendered as current, a proposal reads as permission, or a contributed string renders unescaped. The two material gaps it found (untested whoami and perspective wiring) were closed before this record, with mutation proofs.
- **Evidence verification:** fresh seeds byte-identical to the committed dumps; every keyed claim re-derived from the served JSON (all matched, including the complete-empty and truncated-section claims); participant packet contains no scenario ids, counts, or answers; scoring form complete per §7; baseline hashes recomputed from `git show HEAD:` and matched; runbook executed with both actor-bound viewers and matching served state; no tracked DB/token artifacts; no stray processes.

**Final full-suite record:** `npm run test` passed 86 files / 1064 tests, exit 0, on the recorded final candidate (with the wiring tests added). An earlier run during this sprint flaked on a 30-second timeout in `tests/unit/install-telemetry.test.ts` ("still reports when the recorded preference is explicitly enabled"), which runs `install.sh` telemetry reporting and is unrelated to the Viewer; it passes in isolation (10/10, 6.35s) and passed in the other full runs. The flake is recorded here rather than hidden; no assertion was loosened. `npm run typecheck`, `npm run build`, and `git diff --check` are clean.

## 6. Human observation status (§6.2–§6.3, §7)

Not yet run. Everything needed to run the controlled trace without building anything is frozen and in tree:

- `docs/evidence/swh-001/PARTICIPANT_PACKET.md` — the seven neutral H1–H7 prompts and instructions only (verified to contain no key content).
- `docs/evidence/swh-001/SCENARIO_KEY.md` — the frozen expected IDs/facts and the keyed safe next step, kept separate from the participant packet.
- `docs/evidence/swh-001/SCORING_FORM.md` — item-level scoring with the §7 pass rule (H2, H4, H6, H7 all PASS plus ≥6/7 overall; no averaging away a critical failure) and second-review rows for the critical items. A pre-registered recorder note records that H4's historical decision is reachable only through the workstream, and that a miss is recorded as an observed usability result, not corrected or coached.
- `docs/evidence/swh-001/TRACE_RUNBOOK.md` — seed, two actor-bound Viewers, actor-binding verification, reset.

Required next: two distinct humans (at least one who did not build the page), each on their own actor-bound Viewer, counterbalanced perspective order, up to 15 minutes, no CLI/MCP, verbatim answers scored against the frozen key before any discussion. The reference-open attempt is recorded separately for VIS-001 condition 4, and any ordinary two-human/two-agent continuation is recorded under §6.3 without backfilling gate evidence.

## 7. Deviations, limitations, and notes

- **`supersededDecisions` is always empty in orientation.** The service assembly (`src/service/context-assembly.ts`) hard-codes `supersededDecisions: []`; both service paths follow it. The "superseded (historical)" record group therefore only renders when entries are supplied. Real historical facts reach the home as `historicalCounts` ("Historical: N superseded decisions / M corrected findings recorded — inspect the workstream") and through the existing workstream/detail drill-down. No service change was made — the contract bounds this sprint to the Viewer.
- **`renderCurrentWork` is retained but no longer the production renderer.** The frozen VIS-001 tests call it directly; the perspectives share its decision-boundary logic. It remains the canonical full "current work" renderer and is exercised by the regression suite.
- **The perspective preference is local UI state only** (`localStorage` key `campfire.viewer.perspective`, values `"mine"`/`"team"`); it never contains workspace content and is not shared work state.
- **Attention panels are per-perspective** by design: My work leads with `needsYou`; Team work leads with `needsAttention`; each perspective is always one visible control away.
- **D4/D7 method scans are textual** (`api("literal"` extraction). A computed method name would evade them; the runtime sandbox check (renderers with a throwing `fetch`) is the behavioral backstop.
- **No release artifact was produced.** Version stays `1.16.0`; no tag, public export, installer pin, or deployment. The roadmap and AGENTS.md now describe the implemented-candidate status.

## 8. Open gates and next steps

- Gate B (voluntary repeat use), Gate C (ordinary multi-participant value), and Gate E (historical next-action benefit) remain **unmeasured**. The controlled scenario cannot close any of them.
- VIS-001 condition 4 (reference-open evidence) remains **open**; the shipped-v1.16 Viewer comprehension trace remains **owed**. Both are recorded in `docs/evidence/swh-001/` and must be attributed to VIS-001, not to this sprint.
- The next step is the two-human controlled trace against the frozen key, followed by the item-level result in this document (or an amendment) and a **separate release decision** before any promotion. A founder override of an evidence hold would be recorded as an override, never as a gate pass.

## 9. Founder direction — October 14, 2026

The founder recorded the release path for this candidate:

- The code and tests are ready for a human trace, but they do not by themselves give v1.17 a GO. The pinned result stays **unscored**.
- Publication without completing every observation is possible only under a **separate, recorded founder override** under contract §8, never as a GO verdict. Such a record must show the contract verdict, what it waives, what remains unmeasured, and the exact public claim.
- Recommended sequence: run the two 15-minute controlled traces first. If both pass, that is a substantially stronger basis for a bounded release decision, and the shipped-v1.16 Viewer comprehension trace, a real reference-open attempt, and an ordinary two-human/two-agent continuation may remain explicitly open under a conditional or overridden release. If either participant fails a critical item, repair that usability issue and run a fresh trace before any public launch.
- Any v1.17 release would ship the **read-only Shared Work Home in the existing actor-bound Viewer**. It would not be the hosted, shared-login team experience. There is no v1.17 package, tag, or deployment.

This direction records the release path. It is not a GO, does not close Gate B, C, or E or VIS-001 condition 4, and no release step (version bump, tag, public export, installer pin, deployment) was performed. A bounded publication with open observations requires a separate, recorded founder override naming its waivers and exact public claim; this direction does not provide it.
