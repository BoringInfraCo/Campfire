# CAP-001 fixture answer key

**Date:** 2026-10-20  
**Label: FIXTURE EVIDENCE — engineering evidence only.** Not a human answer and not a sprint verdict. Machine detail is `answer-key.json`. These ids are not catalog content.

Clock base `2026-10-20T12:00:00.000Z`. The one orientation read in the seed reports `generatedAt` `2026-10-20T12:00:56.000Z`.

| Fact | Value |
| --- | --- |
| Authorized actor | `hum_cap001_ada` |
| Denied non-participant | `hum_cap001_zed` |
| Authorized workspace | `ws_cap001_lab` |
| Workspace Ada must not read | `ws_cap001_other` (Zed is the only participant) |
| Goal | `goal_cap001_lab` |
| Blocked task past page 1 | `task_cap001_blocked_later` |
| Selected decision | `dec_cap001_selected` |
| Current finding | `find_cap001_current` |
| Non-current finding | `find_cap001_stale` (`superseded`, successor `find_cap001_current`) |

## Task page

`list_tasks` total 21. Default budget 20. Page 1 ids are `task_cap001_b20` down to `task_cap001_b01` (newest blocked first). `returned` 20, `truncated` true, `nextCursor` present. The cursor keyset is rank 0, `2026-10-20T12:00:34.000Z`, id `task_cap001_b01`. The opaque string is in `answer-key.json`.

`task_cap001_blocked_later` is absent from that page, from `get_workspace_context` `slices.tasks` (same 20 ids), and from `slices.blockers` (first 10 of those ids, `returned` 10 of total 21). It is the only id on page 2. Status `blocked`. No assignee. Created by `hum_cap001_ada` at `2026-10-20T12:00:12.000Z`, blocked at `2026-10-20T12:00:13.000Z`.

Page 2: `returned` 1, `total` 21, `truncated` true, `nextCursor` absent. `truncated` is true because returned is less than total. The store has no further row. Do not treat `truncated` alone as another page.

Context tasks use the same cursor as page 1. `attentionCoverage.completeUnderRules` is false. Orientation findings are `find_cap001_current` only (`returned` 1 of total 1). `historicalCounts.findings` is 1, so the superseded finding is not in that slice. Decisions in orientation: `returned` 1 of total 1, `truncated` false.

`suggestedNextAction` is `task_cap001_b01`, reason `unassigned_blocked_task`, `orientationHint` true. That id is on page 1. It is not `task_cap001_blocked_later`, and it is not an order.

## Decision basis

`dec_cap001_selected` is `accepted`. `needsReview` is true. `needsReviewFindingIds` is `find_cap001_stale` only. Citations: `cit_cap001_stale` → `find_cap001_stale` ("earlier observation"), `cit_cap001_current` → `find_cap001_current` ("corrected observation"). Acceptance is not revoked. `needsReview` is computed at read time.

## Record history

Newest first. Actor on every row is `hum_cap001_ada`. No `nextCursor`. `truncated` false.

| Object | Ids |
| --- | --- |
| `task_cap001_blocked_later` | `con_cap001_0012` update (append 12), `con_cap001_0011` create (append 11). Total 2. |
| `dec_cap001_selected` | `con_cap001_0010`, `con_cap001_0009`, `con_cap001_0008` updates, then `con_cap001_0007` create. Total 4. |

`get_record_history` is the read that returns these ids. `get_activity` does not.

## Denial

Ada `list_tasks` on `ws_cap001_other`: `ParticipantRequired`, message `Actor hum_cap001_ada is not a participant of workspace ws_cap001_other`, `details` null.

Zed `get_workspace_context` on `ws_cap001_lab`: `ParticipantRequired`, message `Actor hum_cap001_zed is not a participant of workspace ws_cap001_lab`, `details` null.

Ada's workspace list is only `ws_cap001_lab`. Zed's is only `ws_cap001_other`. Neither denial contains the other-workspace finding canary.

## What a handoff must say

- The selected later task id, status `blocked`, no recorded assignee, and that it is missing from the first task page and from the orientation task and blocker slices.
- Page coverage: 20 of 21 with a cursor, then 1 of 21 with no cursor. `truncated` true on page 2 is not another page.
- Decision id, status `accepted`, `needsReview` true, both citation ids, and both finding currentness values.
- The contribution ids above when record history was read.
- `completeUnderRules` false, and that orientation did not include the superseded finding.
- `suggestedNextAction` id `task_cap001_b01` is a cue on page 1, not the later task.

## What a handoff must not say

- The first page or the orientation slice is complete.
- `needsReview` means revoked, or permission to act.
- An assignee or agent is live.
- `suggestedNextAction` is an order.
- `campfire activity` replaces `get_record_history`.
- Any fact from `ws_cap001_other`.
