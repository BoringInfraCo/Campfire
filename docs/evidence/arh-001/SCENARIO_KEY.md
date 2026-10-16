# ARH-001 answer key — RESTRICTED

**RESTRICTED — never in participant or agent context; never shown to B before scoring.**
**FIXTURE EVIDENCE — cannot establish ordinary use or external access. The fixture's `example.com` target URLs are synthetic; their external state is NEVER asserted anywhere in this directory. External access is only whatever a real attempt records against a real target.**

Sprint: ARH-001 — Artifact Reference Handoff (proposed v1.21 contract; no implementation, score, verdict, or release decision is recorded).
Contract: `docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md` (§3.1 fixture/key freeze, §3.2 classification, §4 evidence handling, §5 D1–D6, §6 H1–H6, §7 verdicts).
Fixture: `fixtures/artifact-handoff/arh-001/` (`seed.ts`, `dump.ts`, `README.md`) — deterministic ids and clock; two fresh seeds serve byte-identical records (verified: `run-a` / `run-b` dumps `diff -r` clean).
Baseline: `baseline/` — the v1.20.1 pin and served-state capture (recorded by the baseline pass).
Frozen: every fact below is transcribed from the fixture's own `seed-receipt.json` verification block and `dump/` output **before** any attempt, candidate, or score existed. Do not edit after a participant begins; a scenario or rule change is dated and applies only to a fresh run.

## 0. How to use

- Recorder, scorer, and second reviewer only. Transcribe expected facts into `SCORING_FORM.md` before scoring; the second reviewer checks H2–H5 against this key.
- The fixture rehearses the materials and calibrates the runbook. **A fixture run with participants is a rehearsal, not an eligible §3.2 or §6 observation**: the targets are synthetic, so no item here can be scored as ordinary use or external access.
- Re-seeding reproduces the same records (pinned ids, fixed clock). If a rehearsal shows different served facts, stop and re-check the fixture revision; never adjust this key.
- The eligible §6 case does not use this key: for real work, the recorder freezes the real records and expected access before B begins, and that frozen record is the key (see `TRACE_RUNBOOK.md` §3).

## 1. Actors and sessions (frozen)

Team `team_arh001`; organization `org_arh001`.

| Actor | Type | Role | Notes |
| --- | --- | --- | --- |
| `hum_arh001_ana` | human | owner of the lab | owns agent `agt_arh001_opencode` |
| `hum_arh001_ben` | human | member of the lab | owns agent `agt_arh001_codex` |
| `hum_arh001_zed` | human | participant only of `ws_arh001_unrelated` | never a lab/trunc member |
| `agt_arh001_opencode` | agent | lab participant | harness `opencode`; owner Ana |
| `agt_arh001_codex` | agent | lab participant | harness `codex`; owner Ben |

Sessions: `ses_arh001_opencode` (agent `agt_arh001_opencode`, harness `opencode`, workspace lab), `ses_arh001_codex` (agent `agt_arh001_codex`, harness `codex`, workspace lab). Both agents write through their registered sessions, so agent-authored records carry session provenance.

## 2. Workspaces

| Id | Name | Members | Role |
| --- | --- | --- | --- |
| `ws_arh001_lab` | ARH-001 artifact handoff lab | Ana, Ben, both agents | the handoff lab / rehearsal trace workspace |
| `ws_arh001_trunc_artifacts` | ARH-001 truncated artifacts | Ana, Ben | bounded artifacts page (12 total / 10 returned) |
| `ws_arh001_unrelated` | ARH-001 unrelated | Zed only | denial case; never dumped |

Goal (lab): `goal_arh001_handoff` — "Hand the recorded Q3 artifact reference chain to a second teammate and their agent."

## 3. Lab served facts (`ws_arh001_lab`)

### 3.1 Page coverage — all complete

| Slice | total / returned | truncated | nextCursor |
| --- | --- | --- | --- |
| artifacts | 7 / 7 | false | none |
| tasks | 6 / 6 | false | none |
| findings (current slice) | 3 / 3 | false | none |
| decisions | 5 / 5 | false | none |

`historicalCounts = { findings: 1, decisions: 1 }`; superseded decisions replayed in orientation: 0. The superseded finding `find_arh001_superseded` and the superseded decision `dec_arh001_old` exist as historical records (see §4–§5) and are not part of the current slices.

### 3.2 Artifact page order and exact stored references

Served order (cited artifact ranks first, then `created_at` DESC):
`[art_arh001_safe_output, art_arh001_hostile_markup, art_arh001_credentialed, art_arh001_insecure_scheme, art_arh001_path, art_arh001_stale, art_arh001_safe_old_report]`

| Artifact | Type | Title | Stored `uriOrPath` (exact, what the surface serves) |
| --- | --- | --- | --- |
| `art_arh001_safe_output` | `report` | `Q3 handoff analysis (external report)` | `https://example.com/arh-001/q3-handoff-analysis.html` |
| `art_arh001_safe_old_report` | `report` | `Q3 handoff analysis (external report) — earlier draft` | `https://example.com/arh-001/q3-handoff-analysis-draft.html` |
| `art_arh001_stale` | `deployment` | `Preview deployment (stale)` | `https://example.com/arh-001/deployments/old-preview` |
| `art_arh001_path` | `document` | `Local working notes` | `reports/arh-001/working-notes.md` |
| `art_arh001_insecure_scheme` | `file` | `Legacy FTP archive` | `ftp://files.example.com/arh-001/export.tar.gz` |
| `art_arh001_credentialed` | `other` | `Protected analytics view` | `https://arh001-demo-user:arh001-demo-pass@example.com/arh-001/private-view` |
| `art_arh001_hostile_markup` | `other` | `` Report <script>alert(1)</script> `` (stored verbatim) | `https://example.com/arh-001/report"><img src=x onerror=alert(1)>` |

Metadata: `art_arh001_safe_output` → `{ "period": "2026-Q3", "source": "external-reporting" }`; `art_arh001_stale` → `{ "environment": "preview", "note": "superseded" }`; the other five carry no metadata. The stored strings above are exactly what `normalizeArtifactUri` produced (seed-asserted): schemes other than `file:` and relative paths are stored verbatim.

### 3.3 The two similar/historical references (H1)

`art_arh001_safe_output` and `art_arh001_safe_old_report` are the designed distractor pair: both `report`; titles differ only by "(external report)" vs "— earlier draft"; URIs differ only by `-draft`. **Only `art_arh001_safe_output` is the recorded chain source** (see §4). A recipient scores H1's "distinguishes any similar or historical references that are present" only if they separate the current source from the draft; treating the draft as the chain source misreads the record. Neither artifact's external state is asserted by the fixture.

### 3.4 Inert reference classes and what "remain inert" means

The four inert classes are `art_arh001_path` (relative local path), `art_arh001_insecure_scheme` (`ftp:`), `art_arh001_credentialed` (credential-bearing HTTPS), and `art_arh001_hostile_markup` (hostile markup in both title and reference).

At the v1.20.1 baseline (and in the fixture rehearsal) they **remain inert**:

- each reference renders as **escaped plain text** — the Viewer source renders `reference: <code>esc(reference)</code> (stored reference, not fetched)` — with **no anchor/href**, no external link element, and no clickable destination;
- rendering, refresh, hover, and source inspection make **no external request**; nothing is fetched, previewed, or navigated to merely from display;
- the **hostile markup title and reference are escaped** before display (script/img payloads appear as text, never execute);
- the **credential string is displayed as stored text only** and must never become an open control;
- `ftp:` and the local path stay plain text under every surface (dashboard, Viewer).

If §3.2 later supports a §3.3 amendment, only the observed-supported reference class may gain a deliberate user-gesture open (first-browser-control preference: explicitly labeled absolute HTTPS destination, destination host shown, no opener/referrer propagation). Unsupported schemes, local paths, credential-bearing references, and hostile markup **stay inert**; any automatic navigation, server fetch, preview, or proxy blocks the bounded claim (contract §3.3, D3).

## 4. Recorded chain (the handoff source)

Findings (current slice, served order `[find_arh001_current, find_arh001_contradicts, find_arh001_superseded_fix]`):

| Finding | Currentness | Creator (provenance) | Recorded content |
| --- | --- | --- | --- |
| `find_arh001_current` | current | `agt_arh001_opencode` via `ses_arh001_opencode` (Ana's agent) | `sourceArtifactId = art_arh001_safe_output`; summary "The recorded Q3 handoff analysis reference points outside Campfire." |
| `find_arh001_contradicts` | current | `agt_arh001_codex` via `ses_arh001_codex` (Ben's agent) | evidence `fev_arh001_contradicts_stale`, relation `contradicts` → `art_arh001_stale`; records that the old preview must not be offered as the handoff source |
| `find_arh001_superseded_fix` | current | Ana (correction successor) | successor of `find_arh001_superseded`; `predecessorId = find_arh001_superseded` |

Finding evidence (the recorded relationship a handoff needs):

| Evidence row | Finding | Relation | Artifact |
| --- | --- | --- | --- |
| `fev_arh001_current_supports` | `find_arh001_current` | `supports` | `art_arh001_safe_output` |
| `fev_arh001_contradicts_stale` | `find_arh001_contradicts` | `contradicts` | `art_arh001_stale` |

Historical finding (not in the current slice; `historicalCounts.findings = 1`):

| Finding | State | Note |
| --- | --- | --- |
| `find_arh001_superseded` | superseded, successor `find_arh001_superseded_fix`, correction reason recorded | original text preserved: "The Q3 handoff analysis is an internal dashboard export." (COR-001: the old text stays in place); correction reason: "The first reading confused the external report with the internal dashboard export." |

Decision citations:

| Citation | Decision | Cited finding | Note (recorded) |
| --- | --- | --- | --- |
| `cit_arh001_current_basis` | `dec_arh001_current` | `find_arh001_current` | "recorded source chain" |
| `cit_arh001_review_basis` | `dec_arh001_review` | `find_arh001_superseded` | "original reading" |

The wearable chain a recipient can follow: decision `dec_arh001_current` → citation → `find_arh001_current` → `sourceArtifactId`/`supports` evidence → `art_arh001_safe_output` → stored reference. The contradicting relation (`supports` vs `contradicts`) is part of the same served finding slice and must not be conflated.

## 5. Decision lifecycle and read-time decoration

Served order (complete): `[dec_arh001_new, dec_arh001_competing_b, dec_arh001_competing_a, dec_arh001_review, dec_arh001_current]`.

| Decision | Status (served) | Read-time decoration | Recorded basis |
| --- | --- | --- | --- |
| `dec_arh001_current` | accepted | none | cites `find_arh001_current` (`cit_arh001_current_basis`); summary "Treat the Q3 handoff report as the recorded source for the follow-up work." |
| `dec_arh001_review` | accepted | `needsReview = true`, `needsReviewFindingIds = [find_arh001_superseded]` | cites the superseded finding (`cit_arh001_review_basis`); summary "The handoff needs no second source: the Q3 report covers the period."; rationale records it was accepted while the lab believed the report was an internal export |
| `dec_arh001_competing_a` | accepted | none | "Open the external report from the stored reference when the recipient is ready." |
| `dec_arh001_competing_b` | accepted | none | "Keep every external reference inert and hand off by copying the stored URI." |
| `dec_arh001_old` | superseded | excluded from orientation; `successorId = dec_arh001_new`; supersede reason: "The ARH-001 contract replaces the weekly recap; the recorded reference chain is the handoff source." | "Route handoff questions through the weekly recap thread." |
| `dec_arh001_new` | accepted | `predecessorId = dec_arh001_old` | "Replace the recap thread with the recorded artifact reference chain." |

Frozen reading rules (H3):

- `needsReview` is computed at read time. It does **not** retire, replace, or revoke `dec_arh001_review`; the decision stays accepted until an explicit recorded transition.
- `dec_arh001_old` is superseded and must not be promoted back to live; `dec_arh001_new` is the recorded replacement and carries the predecessor link.
- `dec_arh001_competing_a` and `dec_arh001_competing_b` are **both accepted**, conflict on substance, and have **no recorded transition**: no operative winner may be chosen.
- `dec_arh001_current` is accepted with no flags and is the recorded basis linking the work to `find_arh001_current`.

## 6. Tasks and attention (expected next-step context)

Tasks — 6 / 6, all complete slice-wise; page order `[waiting_access, working_notes, archive_draft, followup, wrap_up, verify_chain]`:

| Task | Status | Assignee | Title |
| --- | --- | --- | --- |
| `task_arh001_followup` | open | `agt_arh001_codex` (Ben's agent) | "Follow up on the Q3 handoff analysis reference" |
| `task_arh001_verify_chain` | completed | — | "Verify the recorded evidence chain before handoff" |
| `task_arh001_waiting_access` | blocked | `hum_arh001_ana` | "Confirm the recipient's access to the external report" |
| `task_arh001_working_notes` | in_progress | — | "Draft the handoff checklist from the stored references" |
| `task_arh001_archive_draft` | open | — | "Archive the earlier draft reference" |
| `task_arh001_wrap_up` | completed | — | "Close the ARH-001 lab setup" |

Attention (served; useful for runbook/serving checks — not answers given to a recipient):

| Actor / workspace | `needsYou` | `needsAttention` | `suggestedNextAction` |
| --- | --- | --- | --- |
| `agt_arh001_codex` / lab | `assigned_open_task` → `task_arh001_followup` (exactly this one) | `team_blocked_task` → `task_arh001_waiting_access`; review cue `accepted_decision_needs_review` → `dec_arh001_review` | `task_arh001_followup` (`assigned_open_task`) |
| `hum_arh001_ana` / lab | `assigned_blocked_task` → `task_arh001_waiting_access` | review cue `dec_arh001_review` → `[find_arh001_superseded]` | `task_arh001_waiting_access` (`assigned_blocked_task`) |
| `hum_arh001_ben` / lab | `[]` | `team_blocked_task` → `task_arh001_waiting_access`; review cue `dec_arh001_review` | `task_arh001_followup` (`team_open_task`) |
| `agt_arh001_opencode` / lab | `[]` | `team_blocked_task` → `task_arh001_waiting_access`; review cue `dec_arh001_review` | `task_arh001_followup` (`team_open_task`) |

**Recorder's expected calibration outcome (rehearsal only — the fixture asserts nothing about external reachability).** A recipient who follows the recorded chain uses `art_arh001_safe_output` — not the earlier draft (`art_arh001_safe_old_report`) and not the stale deployment (`art_arh001_stale`) — as the work's source, and leaves a checkable record against `task_arh001_followup` (open, assigned to `agt_arh001_codex`) or records a specific safe block. In a fixture rehearsal this can calibrate H1, H3, H4, H5 only: **H2 cannot pass on a synthetic target**, and nothing in the rehearsal shows whether a real target is reachable, denied, or stale.

## 7. Truncation workspace (`ws_arh001_trunc_artifacts`)

- Artifacts: **12 total / 10 returned / truncated true / nextCursor present.**
- Returned page order: `[art_arh001_trunc_linked, art_arh001_trunc_filler_09, … , art_arh001_trunc_filler_01]`.
- Beyond the page (never in the returned page while rank/recency rules hold): `art_arh001_beyond_page` ("Archived intake log (earliest)", no finding link, oldest creation) and `art_arh001_trunc_older` ("Archived intake log (second)").
- Findings: 1 / 1 — `find_arh001_trunc` (created by Ana) links the returned artifact: `sourceArtifactId = art_arh001_trunc_linked`. Tasks 0 / 0; decisions 0 / 0.
- Rule: **absence from a bounded page is not absence from the workspace** (contract §3.1). A truncated page never supports an "all clear", and counts on one page never describe another.

## 8. Unrelated workspace and expected denials

- `ws_arh001_unrelated` is Zed's alone; its finding `find_arh001_unrelated_sentinel` carries the sentinel `UNRELATED_FINDING_SENTINEL_arh001_do_not_leak`. Ana or Ben reading it must be denied with **no** sentinel, title, count, participant, or finding detail across the boundary. The workspace is never dumped; fixture tooling hard-fails if the sentinel appears in any dump.

Expected denial surface (from `denials.json`; messages echo only the caller-supplied ids):

| Case | Actor | Error name/code | Message (exact) |
| --- | --- | --- | --- |
| read lab context | `hum_arh001_zed` | `ParticipantRequired` | `Actor hum_arh001_zed is not a participant of workspace ws_arh001_lab` |
| read unrelated context | `hum_arh001_ana` | `ParticipantRequired` | `Actor hum_arh001_ana is not a participant of workspace ws_arh001_unrelated` |
| read unknown workspace | `hum_arh001_ana` | `WorkspaceNotFound` | `Workspace not found: ws_arh001_unknown` |
| read trunc artifact through the lab route | `hum_arh001_ana` | `ArtifactNotFound` | `Artifact not found: art_arh001_trunc_linked` |

No title, URI/path, host, relation, count, or access result crosses in any of them. A wrong-workspace object id addressed through the wrong route is simply not found; it does not reveal that the object exists elsewhere.

## 9. What a fixture rehearsal cannot do

- It cannot be the §3.2 **ordinary-work** attempt: a synthetic fixture, a fabricated URL, a scripted builder walkthrough, or an agent acting as the sole "human" does not qualify (contract §3.2). A fixture-only run with participants is a **rehearsal**: label it, record zero H/§3.2 observations, and never score it.
- It cannot establish **external access**: the `example.com` targets are synthetic, and their external state is never asserted. A rehearsal "open" or "denial" reflects only the rehearsal environment.
- It cannot pass **H2's open-and-use** claim, close **VIS-001 condition 4**, move **Gate B, C, E, or F**, or prove ordinary demand, retention, or causal gain over v1.20.1.
- It cannot be evidence that all referenced content is accessible, or that any similar/historical reference is externally current.

## 10. Verdict inputs

`SCORING_FORM.md` holds the §3.2 classification sheet, the H1–H6 item sheets, the diagnostics, the H2–H5 second-review section, the D1–D6 baseline matrix, and the §7 verdict cover sheet. A GO requires a real case meeting H1–H6 including a successful H2 on a genuinely accessible target; if the baseline already works, GO is recorded for the observed case with no v1.21 feature or release required. Fixture tests and rehearsals cannot turn UNSCORED into a human result.

---

**Provenance:** transcribed from `seed-receipt.json` (verification block) and `dump/` at the frozen fixture revision, October 16, 2026; seed base `2026-10-16T16:00:00.000Z`, served read `2026-10-16T18:00:00.000Z`. If any rehearsal diverges from this key, record the divergence — do not edit the key.
