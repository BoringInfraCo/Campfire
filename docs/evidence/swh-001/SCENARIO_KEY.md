# SWH-001 frozen answer key — `swh-billing-deploy`

**FIXTURE EVIDENCE — calibrates UI and rubric; cannot establish Gate B, C, or E.**

Keep this file away from participants and from agent context. It is built from
the served dumps in `served-state/`, not from the intent of the seed script.
Do not edit it to fit candidate output after a participant begins (§6.1).

## 1. Source position

| Item | Value |
| --- | --- |
| Repo commit | `db3a121d3cbbc4beed1965ef6956b3294a109c7c` ("Record v1.16.0 publication and deployment"), package `1.16.0` |
| Seed command | `npx tsx fixtures/swh-001/seed.ts --out fixtures/swh-001/.tmp/run-a --force` |
| Dump command | `npx tsx fixtures/swh-001/dump.ts --db fixtures/swh-001/.tmp/run-a/campfire.db --tokens fixtures/swh-001/.tmp/run-a/tokens.json --out fixtures/swh-001/.tmp/dumps-a` (files copied to `served-state/`) |
| Workspace | `ws_swh001_billing` (`swh-billing-deploy`) |
| Served files | `served-state/context-dana.json` (sha256 `45c90982…381f6`), `served-state/context-rowan.json` (sha256 `728050eb…cd87`), `served-state/workspace-dana.json` (sha256 `23a1d2c7…aab6`) |
| `generatedAt` (both dumps) | `2026-10-13T18:00:00.000Z` — frozen read clock `SERVED_AT`; not wall time |
| `orientationCursor` (both dumps) | `cf1.eyJ2IjoxLCJraW5kIjoiY29udHJpYnV0aW9uIiwid29ya3NwYWNlSWQiOiJ3c19zd2gwMDFfYmlsbGluZyIsIm9jY3VycmVkQXQiOiIyMDI2LTEwLTEzVDE2OjAwOjUzLjAwMFoiLCJpZCI6ImNvbl9zd2gwMDFfMDExMyIsInBoYXNlIjoiaGlnaCIsIm9yaWdpbk9jY3VycmVkQXQiOiIyMDI2LTEwLTEzVDE2OjAwOjUzLjAwMFoiLCJvcmlnaW5JZCI6ImNvbl9zd2gwMDFfMDExMyIsInBvc2l0aW9uIjo1MSwib3JpZ2luUG9zaXRpb24iOjUxLCJ0aXAiOjB9` (tip = contribution `con_swh001_0113`, position 51) |
| Determinism | Two fresh seeds (`run-a`, `run-b`) produced byte-identical dumps; the two contexts differ only in `needsYou` / `needsAttention`. Only raw token values differ run to run (WebCrypto); no token is in this key or the dumps. In addition to token values and hashes, the raw database varies in `schema_migrations.applied_at` (wall-clock), which is invisible to the dumps and this key. |

Goal (`.goal.title` in both dumps): **"Make billing-service deploys
rollback-safe before Friday's release."**

## 2. Actor and owner mapping

| Actor | Id | Type | Workspace role | Harness | `humanOwnerId` |
| --- | --- | --- | --- | --- | --- |
| Dana | `hum_swh001_dana` | human | owner | — | — |
| Rowan | `hum_swh001_rowan` | human | member | — | — |
| Codex | `agt_swh001_codex` | agent | agent | `codex` | `hum_swh001_dana` |
| OpenCode | `agt_swh001_opencode` | agent | agent | `opencode` | `hum_swh001_rowan` |

Both agents are workspace participants with a recorded owner, using different
harnesses. **No agent in this scenario is unowned**, so the D2 "unowned agent"
case is covered by the determined tests, not by this scenario. Tokens are not in
this key; the two human tokens live only in the gitignored `tokens.json` written
by the seed (mode 0600) for the local trace runbook.

Registered agent sessions (provenance only; a session is not live-state proof):
`ses_swh001_codex` (Codex), `ses_swh001_opencode` (OpenCode). Both are open in
the frozen state. Nothing in the served projection says either agent is running,
waiting, or blocked.

## 3. Keyed records

### 3.1 Tasks (`slices.tasks`, complete)

| Id | Title | Status | Assignee | Created by |
| --- | --- | --- | --- | --- |
| `task_swh001_staging_check` | Confirm the rollback checklist on staging | **blocked** | Dana | Dana |
| `task_swh001_reproduce_failure` | Reproduce the failed billing deploy | **in_progress** | Dana | Dana |
| `task_swh001_rollback_job` | Draft the automated rollback job | **open** | Codex (Dana's agent) | Dana |
| `task_swh001_review_drill` | Review the rollback drill report before Friday | **open** | Rowan | Dana |
| `task_swh001_health_checks` | Wire deploy health checks into the rollback job | **open** | OpenCode (Rowan's agent) | Rowan |
| `task_swh001_escalation_owner` | Choose an owner for billing deploy escalations | **blocked** | *unassigned* | Dana |
| `task_swh001_release_checklist` | Update the release checklist with rollback steps | **open** | *unassigned* | Dana |
| `task_swh001_staging_env` | Set up the billing-service staging environment | **completed** | Dana | Dana |

Creation is not assignment: `review_drill` was created by Dana and is Rowan's;
`health_checks` was created by Rowan and belongs to her agent OpenCode;
`rollback_job` belongs to Codex. The completed `staging_env` row appears in
`slices.tasks` and in the detail inspector, but not in `openTasks`, `blockers`,
`currentWork`, or any attention list.

### 3.2 Decisions

| Id | Summary | Frozen state |
| --- | --- | --- |
| `dec_swh001_blue_green` (d1) | Adopt blue-green deploys for billing-service. | **accepted**, `needsReview: true`, `needsReviewFindingIds: ["find_swh001_draining_window"]`, cites f1 (`cit_swh001_0052`); no `predecessorId` / `successorId`; approved by Dana |
| `dec_swh001_canary` (d2) | Adopt canary deploys for billing-service. | **accepted**, clean (`needsReview` absent/false), cites `find_swh001_health_gate` (`cit_swh001_0060`); no `predecessorId` / `successorId`; approved by Rowan |
| `dec_swh001_manual_rollback` (d3) | Escalate billing deploy failures to the on-call engineer for a manual rollback. | **superseded**; `successorId: dec_swh001_automated_rollback`; `supersedeReason: "The rollback drill succeeded; the automated job replaces the manual escalation."`; `supersededBy: {"actorId":"hum_swh001_dana","actorType":"human"}`; `supersededAt: 2026-10-13T16:00:34.000Z` |
| `dec_swh001_automated_rollback` (d4) | Run the automated billing rollback job for failed deploys. | **accepted**; `predecessorId: dec_swh001_manual_rollback`; approved by Dana |
| `dec_swh001_friday_windows` (p1) | Adopt Friday-only billing deploy windows. | **proposed**; rationale records that it is "a scheduling proposal; not agreed" |

d1 and d2 carry **conflicting rationales** (blue-green vs canary) and **no
recorded transition of any kind links them**: neither has a predecessor or
successor; no `decision.superseded`/`decision.rejected` contribution names
either. d1 is flagged only because its cited finding f1 is no longer current.

### 3.3 Findings

| Id | Summary (short) | Frozen state |
| --- | --- | --- |
| `find_swh001_draining_window` (f1) | "The previous color kept serving traffic after the failed rollout was marked rolled back." | **superseded**; `successorId: find_swh001_drain_clean`; `correctionReason: "The drill showed trace 284 captured the pre-drain window, not a stuck rollback."`; source artifact `art_swh001_trace_284`; created by Codex (`ses_swh001_codex`), corrected by Dana. Not in the current findings list. |
| `find_swh001_drain_clean` (f2) | "Traffic drains cleanly once the rollback job stops opening connections; trace 284 ended mid-drain." | **current**; `predecessorId: find_swh001_draining_window`; source artifact `art_swh001_drill_report`; evidence `fev_swh001_0040` → `art_swh001_drill_report`, relation `supports`, note `"drill report section 3"`; created by Dana. |
| `find_swh001_health_gate` (f3) | "Deploy health checks pass only after the new color reports ready, so a canary halt leaves the previous color serving." | **current**; no source artifact and no evidence rows (explicit absence); created by OpenCode (`ses_swh001_opencode`). |

`historicalCounts` = `{ "findings": 1, "decisions": 1 }`.

### 3.4 Artifacts

| Id | Type | Title | Stored reference | Separate access status (frozen) |
| --- | --- | --- | --- | --- |
| `art_swh001_trace_284` (a1) | `trace` | billing-service rollout traffic trace 284 | `https://internal.example/billing/traces/284` | External; **not independently accessible** to the participants from this workspace read |
| `art_swh001_drill_report` (a2) | `report` | billing-service rollback drill report (17) | `https://internal.example/billing/reports/rollback-drill-17` | External; not independently accessible; it is f2's cited evidence |
| `art_swh001_runbook_ref` (a3) | `file` | Rollback runbook reference | `docs/ARCHITECTURE.md` | **Known accessible**: this repo-relative path exists at the source commit; both participants can open it with their own tooling (editor/terminal/file browser) outside the Viewer |
| `art_swh001_pr_284` (a4) | `pull_request` | Add the automated billing rollback job | `https://github.example/billing-service/pull/284` | External; not independently accessible |
| `art_swh001_checklist_05` … `checklist_12` | `document` | Deploy checklist snapshot 05…12 | `https://internal.example/billing/docs/deploy-checklist-0N` | Low-noise filler; not independently accessible |

Only the first four are keyed. The Viewer shows the reference; it never fetches
or verifies it. Listing a reference is not proof it exists or is accessible.

## 4. Slice completeness (identical in both dumps)

| Slice | total | returned | truncated | Keyed content |
| --- | --- | --- | --- | --- |
| `tasks` | 8 | 8 | **false** | all 8 tasks, including completed `staging_env` |
| `blockers` | 2 | 2 | false | `escalation_owner`, `staging_check` (blocked, updatedAt DESC) |
| `findings` (current) | 2 | 2 | false | `drain_clean`, `health_gate` (f1 excluded) |
| `decisions` | 4 | 4 | false | order `[automated_rollback, canary, blue_green, friday_windows]` (accepted by updatedAt DESC, then proposed) |
| `artifacts` | 12 | **10** | **true** | returned page `[drill_report, trace_284, checklist_12 … checklist_07, pr_284, runbook_ref]`; excluded: `checklist_06`, `checklist_05`; `nextCursor` present |
| `recentChanges` | 51 | 20 | true (secondary) | newest material changes |
| `provenance` (`provenanceTotal` 51) | — | 20 | true (secondary) | `provenanceTruncated: true` |

`completeness` = `{ "fullHistoryIncluded": false, "drillDownAvailable": true }`;
`budget` = `{goals:1, decisions:10, findings:10, tasks:20, blockers:10, artifacts:10, recentChanges:20}`.
`alignment` = `{status: "open", proposedDecisionIds: ["dec_swh001_friday_windows"], acceptedDecisionIds: ["dec_swh001_blue_green", "dec_swh001_canary", "dec_swh001_automated_rollback"], unresolvedBlockedTaskIds: ["task_swh001_staging_check", "task_swh001_escalation_owner"]}`.
`currentWork` = inProgress `["task_swh001_reproduce_failure"]`, blocked `["task_swh001_staging_check", "task_swh001_escalation_owner"]` (ascending updatedAt), accepted `[blue_green (flagged), canary, automated_rollback]` (ascending updatedAt) — a different order from `slices.decisions`, so row order cannot identify an operative decision.

## 5. Attention per participant (from the served dumps)

### Dana (`context-dana.json`)

`needsYou` (in order):

1. `proposed_decision_actionable` → `dec_swh001_friday_windows` (proposed)
2. `assigned_blocked_task` → `task_swh001_staging_check` (blocked, assignee Dana)

`needsAttention`:

1. `unassigned_blocked_task` → `task_swh001_escalation_owner` (blocked, no assignee)

`suggestedNextAction` = `{ kind: "decision", id: "dec_swh001_friday_windows", reason: "proposed_decision_actionable", orientationHint: true }`.

### Rowan (`context-rowan.json`)

`needsYou` (in order):

1. `proposed_decision_actionable` → `dec_swh001_friday_windows` (proposed)
2. `assigned_open_task` → `task_swh001_review_drill` (open, assignee Rowan)

`needsAttention`:

1. `unassigned_blocked_task` → `task_swh001_escalation_owner` (blocked, no assignee)
2. `team_blocked_task` → `task_swh001_staging_check` (blocked, assignee Dana)

`suggestedNextAction` = same p1 hint as Dana.

Shared facts (slice counts, tasks, decisions, findings, artifacts, goal) are
identical in both dumps. Tasks assigned to an **agent** (`rollback_job`,
`health_checks`) are owned-agent work but are **not** `needsYou` items in the
service projection; they belong to Dana's/Rowan's agents under the H2 ownership
question, not under the attention reasons. The p1 hint is an orientation hint,
never an instruction to execute.

## 6. Empty complete section and truncated section (H6 anchors)

**Keyed empty complete group: Rowan has no blocked task.** The tasks slice is
complete, so "none" is honest for that group. Exact served evidence
(`context-rowan.json`):

```json
"slices": { "tasks": { "items": [ … 8 rows … ], "total": 8, "returned": 8, "truncated": false } }
```

and the only Rowan-assigned task is open:

```json
{ "assignee": { "actorId": "hum_swh001_rowan", "actorType": "human" },
  "id": "task_swh001_review_drill", "status": "open" }
```

A filter of `slices.tasks.items` for `status === "blocked"` yields
`["task_swh001_escalation_owner", "task_swh001_staging_check"]` — neither is
Rowan's — and Rowan's `needsYou` contains no `assigned_blocked_task`. Secondary:
Dana has no `open` assigned task (her rows are blocked, in_progress, completed).

**Keyed truncated section: `artifacts`.** `total: 12`, `returned: 10`,
`truncated: true` with a `nextCursor`; `checklist_06` and `checklist_05` are
undisplayed but exist (`workspace-dana.json` shows all 12). Secondary
truncation: `recentChanges` 20/51 and `provenance` 20/51. A correct H6 answer
uses counts + `truncated` + the existing drill-down path and never reads the
10-row artifact page as the whole workspace.

## 7. Safe next step (H7, frozen)

> Seek an explicit retirement or an accepted replacement naming its predecessor
> and reason **before executing either of the conflicting accepted rules**
> `dec_swh001_blue_green` (d1, blue-green) or `dec_swh001_canary` (d2, canary).
> Cite the recorded `needsReview: true` state of d1 and its cited non-current
> finding `find_swh001_draining_window` (f1, superseded by
> `find_swh001_drain_clean`). Do not treat `dec_swh001_friday_windows` (p1) as a
> task or permission. A suggested action is an orientation hint, not authority.
> `dec_swh001_manual_rollback` (d3) is already superseded by
> `dec_swh001_automated_rollback` (d4) and must not be executed either.

## 8. H1–H7 expected answers (cross-referenced to served JSON)

| Item | Expected answer | Served-state reference |
| --- | --- | --- |
| **H1 — current work** | Goal: "Make billing-service deploys rollback-safe before Friday's release." Open: `rollback_job` (Codex), `review_drill` (Rowan), `health_checks` (OpenCode), `release_checklist` (unassigned). In progress: `reproduce_failure` (Dana). Blocked: `staging_check` (Dana), `escalation_owner` (unassigned). `staging_env` is completed and must not be called active. | `context-*.json` `.goal.title`, `.slices.tasks.items`, `.openTasks`, `.currentWork`; `workspace-dana.json` `.tasks` |
| **H2 — ownership** | Dana: `staging_check` (blocked), `reproduce_failure` (in progress), `staging_env` (completed); Dana's agent Codex: `rollback_job`. Rowan: `review_drill`; Rowan's agent OpenCode: `health_checks`. No recorded owner: `escalation_owner` (blocked) and `release_checklist` (open). Creation is not assignment. | `.participants`, `.slices.tasks.items[].assignee`, `workspace-dana.json` `.participants` |
| **H3 — attention** | separates needsYou from needsAttention. Both: `proposed_decision_actionable` → `friday_windows`. Dana needsYou adds `assigned_blocked_task` → `staging_check`; Dana needsAttention `unassigned_blocked_task` → `escalation_owner`. Rowan needsYou adds `assigned_open_task` → `review_drill`; Rowan needsAttention adds `unassigned_blocked_task` → `escalation_owner` and `team_blocked_task` → `staging_check`. No claim about an agent's live state. | `.needsYou`, `.needsAttention`, `.suggestedNextAction` |
| **H4 — decision safety** | Accepted: d1 `blue_green` (**needsReview**, cites non-current f1), d2 `canary` (clean), d4 `automated_rollback` (recorded predecessor d3). Proposed: p1 `friday_windows`. Historical: d3 `manual_rollback` superseded by d4 with reason; nothing links d1/d2. Team must not invent a single operative decision or execute either conflicting rule; p1 is not settled and not a task. | `.acceptedDecisions`, `.proposedDecisions`, `.slices.decisions.items[].predecessorId`, `.historicalCounts.decisions`; `workspace-dana.json` `.decisions` (d3 successor/reason/supersededAt) |
| **H5 — source trail** | Example keyed claim: f2 `drain_clean` supports rollback safety; its evidence is `fev_swh001_0040` → a2 `drill_report` (`supports`, note "drill report section 3"), stored reference `https://internal.example/billing/reports/rollback-drill-17`. Or: d1's basis f1 `draining_window` is non-current, and a1 `trace_284` is the external trace reference. f3 `health_gate` has no artifact (explicit absence). The listed target is not proof it exists, was fetched, or is accessible; a1/a2/a4 are external. | `.findings[].evidence`, `.findings[].sourceArtifactId`, `.acceptedDecisions[].citations`, `.slices.artifacts.items[].uriOrPath` |
| **H6 — completeness** | Complete: tasks 8/8, findings 2/2, decisions 4/4, blockers 2/2. Truncated: artifacts **10 of 12** (`truncated: true`, `nextCursor` present; `checklist_06`/`checklist_05` undisplayed but real). Secondary: recentChanges 20/51, provenance 20/51. Empty complete section: Rowan has **no blocked task**; "none" is honest there. Next inspection for a missing artifact: use the existing drill-down (and detail inspection) rather than assuming it does not exist. | `.slices.*`, `.completeness.drillDownAvailable`, §6 above |
| **H7 — next step** | §7 above, with d1/d2/f1 IDs, the explicit transition requirement, and the "hint not permission" caveat. | `.acceptedDecisions` (d1 needsReview), `workspace-dana.json` `.findings` (f1 superseded), `.suggestedNextAction` |

## 9. Notes that must not be scored as defects

- `generatedAt` is the frozen read clock, not the moment of generation.
- Raw tokens differ per seed run by construction; they are not workspace content.
- `recentChanges` and `provenance` truncate naturally at 20 of 51; the key
  treats this as secondary, and H6 credit does not depend on naming them.
- The seed's own verification reads advance the seed clock; the served dumps are
  written by `dump.ts` and are the only source of truth for the key.
