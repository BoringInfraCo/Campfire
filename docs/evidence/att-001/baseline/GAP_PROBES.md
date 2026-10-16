# ATT-001 baseline gap probes (v1.18.0)

FIXTURE EVIDENCE — calibrates UI and rubric; cannot establish Gate B, C, or E.

For each expected gap in `docs/Campfire-v1.19-ATT-001-Trustworthy-Team-Attention.md`
§2, recorded whether it reproduces on this frozen v1.18.0 baseline, with exact
references to the captured files. All four gaps reproduce. Nothing here is a
human-comprehension result; the captures show what the shipped surface renders,
not what a person understood.

The baseline was re-produced fresh from a clean v1.18.0 worktree after the
scenario repair v2 (`SCENARIO_REPAIR.md`); every reference below was re-verified
against the re-produced captures, and all four verdicts are unchanged.

## Gap 1 — truncated source pages; attention lists carry no coverage metadata

**Reproduces: YES.**

- `served-state/context-ws_att001_trunc_tasks-ana.json`: `slices.tasks` is
  `{ total: 22, returned: 20, truncated: true }`; `needsYou` and
  `needsAttention` are both `[]`. Nothing on the attention data says the task
  page was bounded.
- `captures/baseline-ws_att001_trunc_tasks-ana-mine.txt` (lines 6–7):
  `NEEDS YOU` / `You're all caught up` — the empty attention message is
  unqualified. The Current Work panel separately reports
  `tasks showing 20 of 22 · more available — open the list for the rest`
  (line 19), but that sentence is not attached to the attention list.
- `captures/baseline-ws_att001_trunc_tasks-ana-team.txt` (lines 6–7):
  `NEEDS ATTENTION` / `Nothing needs attention`, again unqualified.
- `served-state/context-ws_att001_trunc_decisions-ana.json`: `slices.decisions`
  is `{ total: 12, returned: 10, truncated: true }`; both attention lists are
  `[]`. `captures/baseline-ws_att001_trunc_decisions-ana-mine.txt` (28–29) and
  `-team.txt` (28–29) show `You're all caught up` / `Nothing needs attention`
  without a page-boundary statement.
- `served-state/context-ws_att001_trunc_both-ana.json`: both slices truncated
  (`22/20` and `12/10`); `captures/baseline-ws_att001_trunc_both-ana-mine.txt`
  (28–29) and `-team.txt` (28–29) show the same unqualified empty messages
  while the Current Work panel reports both truncated counts (lines 41 and 66
  in `mine`).
- The affected record: `task_att001_inprogress_*` fillers occupy the returned
  page, and the open, Ana-assigned `task_att001_beyond_open_ana` sits outside
  it; the review decision `dec_att001_page_review` is inside its page while the
  superseded-citing `dec_att001_beyond_review` is outside it. Neither boundary
  is visible in the attention panels.

## Gap 2 — accepted `needsReview` decisions absent from both attention lists

**Reproduces: YES.**

- `served-state/context-ws_att001_lab-ana.json`: in `slices.decisions.items`,
  `dec_att001_review_superseded` has `needsReview: true` and
  `needsReviewFindingIds: ["find_att001_superseded"]`;
  `dec_att001_review_withdrawn` has `needsReview: true` and
  `needsReviewFindingIds: ["find_att001_withdrawn"]`. Neither id appears in
  `needsYou` or `needsAttention` (which contain only the four tasks
  `task_att001_blocked_ana`, `task_att001_open_ana`,
  `task_att001_blocked_noassignee`, `task_att001_blocked_opencode`; the
  repaired lab has no proposed decision).
- Decision surfaces do show the flag:
  `captures/baseline-ws_att001_lab-ana-mine.txt` (lines 17–21) lists both ids
  under `accepted needing review`, and the My work decision groups (lines 76
  and 79) print `needs review cites non-current finding
  find_att001_superseded` and `... find_att001_withdrawn`.
- The Viewer team attention panel does not:
  `captures/baseline-ws_att001_lab-ana-team.txt` (lines 29–37) shows only
  `task_att001_blocked_noassignee` (`unassigned_blocked_task`) and
  `task_att001_blocked_opencode` (`team_blocked_task`) under
  `NEEDS ATTENTION`.
- Same shape on a truncated page: `dec_att001_page_review` has
  `needsReview: true` in `served-state/context-ws_att001_trunc_decisions-ana.json`
  and renders under `accepted needing review`
  (`captures/baseline-ws_att001_trunc_decisions-ana-mine.txt` lines 25–26)
  while both attention lists are empty and render unqualified
  (`-team.txt` lines 28–29).

## Gap 3 — another participant's task cued under team attention; the caller can still write

**Reproduces: YES.**

- The cue: `captures/baseline-ws_att001_lab-ana-team.txt` (lines 34–37) shows
  `task · blocked` / `task_att001_blocked_opencode` /
  `Reproduce the truncated-page cue gap` / `team_blocked_task` under
  `NEEDS ATTENTION`. The task's recorded assignee is `agt_att001_opencode`
  (`served-state/context-ws_att001_lab-ana.json`, `slices.tasks.items`).
- The write: `probe/ana-updates-opencode-task.json` — on a separate fresh seed
  instance, Ana (`hum_att001_ana`) updated the same task from `blocked` to
  `in_progress` through the dispatched service. `outcome: "allowed"`; the
  recorded contribution's `actor.actorId` is `hum_att001_ana`, and the returned
  task keeps its recorded assignee. The cue describes recorded assignment and
  orientation, not an access boundary, and the caller can still write.

## Gap 4 — complete returned page with an unassigned open task and both attention lists empty

**Reproduces: YES.**

- `served-state/context-ws_att001_quiet-ana.json`: `slices.tasks` is
  `{ total: 3, returned: 3, truncated: false }`; `openTasks` contains
  `task_att001_quiet_open` (`open`, no assignee); `needsYou` and
  `needsAttention` are both `[]`; `suggestedNextAction` is
  `{ kind: "task", id: "task_att001_quiet_open", reason: "team_open_task" }`.
- `captures/baseline-ws_att001_quiet-ana-mine.txt` (lines 9–14): the suggested
  next action points at `task task_att001_quiet_open` / `team_open_task` while
  `NEEDS YOU` says `You're all caught up`; the task remains visible in Team work
  (`captures/baseline-ws_att001_quiet-ana-team.txt` lines 16–19: `Unassigned` /
  `open` / `Choose the quiet-desk next step` /
  `id task_att001_quiet_open · unassigned`) with `Nothing needs attention`
  (lines 9–10). Empty attention means no item matches the current cue rules,
  not that the team is finished; this baseline itself demonstrates the
  in-scope work still present.

## Summary

| Contract §2 gap | Reproduces | Primary evidence |
| --- | --- | --- |
| 1. Truncated pages, no coverage on attention lists | YES | `context-ws_att001_trunc_tasks|trunc_decisions|trunc_both-ana.json`; `captures/baseline-ws_att001_trunc_*-ana-mine/team.txt` |
| 2. `needsReview` accepted decisions absent from attention | YES | `context-ws_att001_lab-ana.json`; `captures/baseline-ws_att001_lab-ana-mine/team.txt`; `context-ws_att001_trunc_decisions-ana.json` |
| 3. Team cue for another participant's task while the caller can write | YES | `captures/baseline-ws_att001_lab-ana-team.txt`; `probe/ana-updates-opencode-task.json` |
| 4. Complete page, unassigned open task, empty attention | YES | `context-ws_att001_quiet-ana.json`; `captures/baseline-ws_att001_quiet-ana-mine/team.txt` |

No gap failed to reproduce, so no contract amendment is triggered by this
probe set. These are interface observations on a frozen fixture; they do not
establish that any human encountered the gaps in ordinary work, and they do not
close WCO-001, SWH-001, or any Gate.
