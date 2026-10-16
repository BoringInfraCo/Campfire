# UIX-001 field map

**Date:** October 16, 2026  
**Command name (frozen):** `dashboard`  
**Usage:** `campfire dashboard [workspace]`  
**Source module:** `src/presentation/work-console.ts`  
**Viewer sentences:** `src/viewer/static/app.js` (`ATTENTION_REASON_LABELS`, `attentionCoverageText`, `attentionEmptyText`)  
**Service:** authorized `get_workspace_context`. Detail may call the existing `get_task`, `get_finding`, `get_decision`, or `get_artifact` for one id in that workspace. No second work feed.

This table is presentation only. It does not add a reason, a lifecycle, a reviewer, a presence state, or a permission.

| Source field | Displayed label | Notes both surfaces keep |
| --- | --- | --- |
| `workspace.name`, `workspace.id` | workspace name and id | Switching workspace stays explicit. |
| `goal.title`, `goal.id` | GOAL plus the recorded title and id | Absent goal stays absent. |
| `participants` where `actorType` is human or agent | `N people · M registered agents` | Count of recorded participants. Never "online", "working", "idle", or "blocked" as agent presence. |
| participant `name`, `harness`, `humanOwnerId` | name, harness, recorded owner | An unended session is not presence. |
| `needsYou` / `needsAttention` | My work shows Needs You; Team work shows Needs Attention | The switch changes presentation only. |
| `AttentionItem.reason` | plain sentence in `ATTENTION_REASON_LABELS`; raw code kept | Unknown codes render as themselves, stripped of controls. |
| `AttentionItem.id`, `kind`, `status` | source id, kind, lifecycle token | Never dropped, including at narrow width. |
| `AttentionItem.assignee.actorId` | `assignee: <id>` | Plus the assignment-is-a-record note. Not a permission grant or denial. |
| `needsReviewFindingIds` | `non-current citations: <ids>` | Shown only when the service set them. |
| `attentionCoverage.tasks` / `.decisions` | `returned/total` and `returned of total`, plus truncated when `truncated` is true | Same object the list was rendered from. |
| `attentionCoverage.completeUnderRules === true` and empty list | "No recorded attention cues match these rules. This does not mean all work is done." | Not an all-clear. |
| coverage incomplete or truncated, empty list | "No cue found in the returned records; more matching records may exist." | |
| coverage missing | "No recorded attention cues in the returned records; completeness was not reported." | |
| truncated coverage, list empty or not | "Cues beyond the returned pages may exist." | |
| complete coverage | "Both source pages are complete." | Still not "all work is done". |
| `openTasks` / `currentWork` status `open`, `in_progress`, `blocked` | lifecycle token kept (`open`, `in_progress`, `blocked`) | Completed tasks are not current work. |
| `proposedDecisions` | `proposed — not accepted, not an instruction` | Not an order to act. |
| `acceptedDecisions` with `needsReview` | `accepted` and "needs review" | Acceptance stays. Not retired, not superseded. |
| `acceptedDecisions` without `needsReview` | `accepted` | |
| competing accepted decisions | both ids, both accepted | No operative choice. |
| `supersededDecisions` | `superseded — historical` | Not revived by a review cue. |
| `suggestedNextAction` | `orientation hint, not an action` | Omitted rather than shown unlabeled. |
| `artifacts[].type`, `uriOrPath`, `id` | type, stored path, id, `stored reference, not fetched` | No fetch, preview, or external link. |
| `provenance` / `slices.recentChanges` | actor, action, record id, `showing returned of total` | Bounded. A refresh error keeps the last page and says stale. |
| detail | method name and source id | `get_workspace_context` when the row is already in that read; otherwise the get-by-id method. Workspace id is the authorized one. |

## Frozen command behavior

- Interactive TTY only. A non-TTY invocation prints `DASHBOARD_NON_TTY_MESSAGE` and no cursor or color controls.
- `status` and its JSON output stay the existing contract.
- `p` switches My work / Team work. `tab` moves sections. `j`/`k` move. `enter` inspects. `r` refreshes. `?` help. `q` and Ctrl-C restore the terminal.
- Record text is passed through `stripTerminalControls` before it is written.

## Evaluation fixture

The frozen workspace is the existing ATT-001 scenario (`fixtures/attention/att-001/`, scenario v2). UIX-001 does not rescore ATT-001 H1–H6. Screenshot sizes for later inspection: terminal 80×24 and 120×36; browser 1440×900 and 390×844.

Cold tasks, answered from that fixture for `ws_att001_lab`. These are the answer key, not a human observation.

| Task | Required answer |
| --- | --- |
| Find the goal | `goal_att001_attention`: "Make team attention cues trustworthy without changing recorded work." |
| Next recorded task and assignee | Name the task id the service `suggestedNextAction` points at for the acting participant, and the assignee recorded on that task. Ana's returned assigned tasks include `task_att001_blocked_ana` and `task_att001_open_ana`. The hint is not permission to act. |
| Needs-review accepted decision | `dec_att001_review_superseded` cites `find_att001_superseded`; `dec_att001_review_withdrawn` cites `find_att001_withdrawn`. Both stay accepted. |
| Truncated attention source | Lab tasks are 21 total / 20 returned / truncated. An empty list on that page is incomplete, not "the team is done". Ben's My work list is the incomplete-empty case. |
| Cited artifact reference | `art_att001_runbook_ref` (and `art_att001_trace_284`) are stored references. The surface must not fetch them. |
| Competing decisions | `dec_att001_competing_a` and `dec_att001_competing_b` are both accepted. Neither is chosen as operative. |

A participant who built the change is a debugging rehearsal if they walk these tasks. That walk is not the two-person observation.
