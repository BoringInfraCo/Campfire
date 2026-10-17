# NAV-001 Fixture Key — `ws_nav001_lab` (frozen answer key)

**Label: FIXTURE EVIDENCE — engineering evidence only.** This key describes a
deterministic fixture built by `fixtures/navigator/nav-001/seed.ts`. It cannot
establish Gate B, Gate C, or Gate E, and nothing here is human-observation
evidence.

## Provenance and determinism

- Fixture: `fixtures/navigator/nav-001/seed.ts` (mechanisms mirror
  `fixtures/attention/att-001/seed.ts`: fixed `queueSource`, fixed seed clock,
  `inviteAndJoin` participation, recorded `correct_finding` /
  `citeFindingEvidence`, receipt flow).
- Seed clock: frozen base `2026-10-17T12:00:00.000Z`, +1000 ms per recorded
  write. Served state is read at the frozen serve time recorded in the receipt:
  `2026-10-17T14:00:00.000Z`.
- Determinism check: two independent seeds into `.tmp/run-a` and `.tmp/run-b`,
  each dumped with `dump.ts`; `diff -r` across the two dump trees is
  **byte-identical** (0 differences). The only expected between-run difference
  lives outside the dumps (the `databasePath` field of `seed-receipt.json`);
  tokens themselves differ by design (fresh secrets per seed).
- `tokens.json` and `seed-receipt.json` are written mode **0600** in both runs.
- A later re-seed reproduced the frozen ids again (`seed-run` exit 0). The
  seed's assertion helper is silent on success and throws on failure, so exit
  status plus byte-identical dumps are the recorded evidence.

## Identity and inventory

| Object | Frozen value |
| --- | --- |
| Workspace | `ws_nav001_lab` ("nav-001 display-pressure lab") |
| Goal | `goal_nav001_focus` — "Give the terminal one focused screen over the recorded work." |
| Tracked humans | `hum_nav001_ana`, `hum_nav001_ben` (both lab members) |
| Lab humans total | 20 (fixed 20-human roster) |
| Lab agents total | 37 (`agt_nav001_01` … `agt_nav001_37`; odd = `codex`, even = `opencode`; owner = the fixed human roster member at `index % 20`) |
| Participants | 57 (20 human + 37 agent) |
| Tasks | 64 (58 fillers + 6 keyed) |
| Findings in lab | 2 (`find_nav001_current` = current; `find_nav001_superseded` = superseded) |
| Decisions | 5 |
| Artifacts | 12 |
| Unrelated workspace | `ws_nav001_unrelated`, participant Zed only, holds finding `find_nav001_unrelated` whose text embeds the nav-001 unrelated sentinel (`const UNRELATED_FINDING_SENTINEL`) |

## Served task page (20 rows; the shape the dashboard renders)

Ordering: rank `blocked` → `in_progress` → `open`, `updated_at` descending
within each rank, page limit 20.

```text
blocked       task_nav001_blocked_agent            agt_nav001_01   "Reproduce the eager-dump pressure"
blocked       task_nav001_blocked_noassignee       (none)          "Decide what counts as a focused screen"
blocked       task_nav001_assigned_blocked_ana     hum_nav001_ana  "Package the display-pressure baseline"
blocked       task_nav001_f052                     agt_nav001_34
blocked       task_nav001_f039                     agt_nav001_21
blocked       task_nav001_f026                     agt_nav001_08
blocked       task_nav001_f013                     hum_nav001_h15
in_progress   task_nav001_f058                     hum_nav001_h05
in_progress   task_nav001_f045                     agt_nav001_27
in_progress   task_nav001_f032                     agt_nav001_14
in_progress   task_nav001_f019                     agt_nav001_01
in_progress   task_nav001_f006                     hum_nav001_h08
open          task_nav001_hostile                  (none)          "nav-001 host[ile] title" (see Hostile content)
open          task_nav001_open_noassignee          (none)          "Pick the screen reviewer"
open          task_nav001_assigned_open_ana        hum_nav001_ana  "Give the terminal one focused screen"
open          task_nav001_f057                     hum_nav001_h04
open          task_nav001_f056                     hum_nav001_h03
open          task_nav001_f055                     agt_nav001_37 (owner = hum_nav001_h17)
open          task_nav001_f054                     agt_nav001_36
open          task_nav001_f053                     agt_nav001_35
```

The page contains **all six keyed tasks**; 44 fillers sit beyond the page.
Coverage reported as `20 of 64 (truncated)`; frame lines render `20/64 truncated tasks · 5/5 decisions`.

Filler status rule (the **recorded limitation**, see below): filler status is the
weighted cycle `N % 13` over the filler number — `0` → blocked
(f013, f026, f039, f052: 4 blocked), `6` → in_progress (f006, f019, f032, f045,
f058: 5 in_progress), otherwise open (49 open fillers).

## Artifact page (10 rows of 12)

Engine attaches 9 filler documents first, then the three keyed artifacts, then
the keyed-blocked task updates last, so the keyed artifacts are the newest rows
in the `updated_at`-descending artifact rank.

```text
1 art_nav001_notes     document  nav-001/working-notes.md                     class: local path
2 art_nav001_hostile   other     hostile markup URI (see below)               class: unparsed
3 art_nav001_runbook   report    https://example.com/nav-001/runbook.html     class: openable https  host example.com
4 art_nav001_f09 … 10 art_nav001_f03  document  nav-001/filler-reference-NN.md  class: local path
```

Dropped beyond the page: `art_nav001_f01`, `art_nav001_f02` (10 of 12 =
truncated). The runbook row carries the recorded citation `cited by
find_nav001_current (supports)`. All artifact rows render the inert-chrome
note "stored reference, not fetched / external and unverified by Campfire;
workspace membership does not grant access" — v1.21.0 includes the `class` and
`host` labels on these rows.

## Decisions (4 accepted + 1 proposed)

| Decision | Status | Cue state |
| --- | --- | --- |
| `dec_nav001_proposed` | proposed — **not accepted, not an instruction** | `proposed_decision_actionable` (needs-you; suggested next action) |
| `dec_nav001_review` | accepted | cited finding `find_nav001_superseded` is **not current** → `needsReview`, `accepted_decision_needs_review` cue |
| `dec_nav001_competing_a` | accepted | unresolved competing pair — **neither is operative**; no retirement, no replacement |
| `dec_nav001_competing_b` | accepted | unresolved competing pair — **neither is operative**; no retirement, no replacement |
| `dec_nav001_plain` | accepted | no citations, no cue (added so the decision slice reaches the frozen `{5,5}` shape; documented deliberate fill) |

## Attention answers (from the sanitized dumps, both dumps identical)

- **Ana needsYou (3, in order):**
  1. `dec_nav001_proposed` — `proposed_decision_actionable`
  2. `task_nav001_assigned_blocked_ana` — `assigned_blocked_task`
  3. `task_nav001_assigned_open_ana` — `assigned_open_task`
  (the assigned open task is inside the returned page; without the pages
  being returned the cue would not exist — cues derive from returned pages)
- **Ben needsYou (1):** `dec_nav001_proposed` (`proposed_decision_actionable`)
  only.
- **Suggested next action (both):** `dec_nav001_proposed`
  ("Adopt the focused single-screen terminal layout."), `orientationHint: true`.
- **Ana `needsAttention` (7 cues, in order):**
  `task_nav001_blocked_noassignee` (`unassigned_blocked_task`);
  `task_nav001_f013` (`team_blocked_task`, owner hum h15);
  `task_nav001_f026` (`team_blocked_task`, agt 08);
  `task_nav001_f039` (`team_blocked_task`, agt 21);
  `task_nav001_f052` (`team_blocked_task`, agt 34);
  `task_nav001_blocked_agent` (`team_blocked_task`, agt 01);
  `dec_nav001_review` (`accepted_decision_needs_review`,
  `needsReviewFindingIds: [find_nav001_superseded]`).
- **Ben `needsAttention` (8 cues):** Ana's 7 plus
  `task_nav001_assigned_blocked_ana` as a `team_blocked_task` cue (owner Ana).
- **Coverage block (both):** tasks `{20 of 64, truncated}`, decisions
  `{5 of 5, not truncated}`, `completeUnderRules: false` — cues beyond the
  returned pages may exist and the record says so.

## Hostile content (must render inert)

- `HOSTILE_TASK_TITLE` (`task_nav001_hostile`) carries a raw ANSI color escape
  plus a terminal BEL inside the stored title. The v1.21.0 renderer strips all
  C0 controls including ESC and BEL, so the title shows as inert text; capture
  checks report `noEscapeControls: true` and no bell remaining. The terminal
  dashboard offers no open/visit action for any reference.
- The hostile artifact `art_nav001_hostile` stores a URI that embeds HTML
  markup (an `<img onerror>` payload after a quoted-attribute break). v1.21.0
  classifies it **"unparsed"**: rendered as inert stored text, no open control,
  no host promotion.
- `art_nav001_notes` is a **local-path** document (no scheme) — inert stored
  reference.
- No credential-shaped token value appears on any screen (tokens exist only in
  `tokens.json`, mode 0600, never rendered).

## Authorization boundary

- `hum_nav001_zed` is a participant **only** of `ws_nav001_unrelated`. Both lab
  reads (`get_workspace_context`, `get_workspace`) return `ParticipantRequired`
  with a message that names only the caller and the workspace id; two denial
  records are captured in `denials.json`. Zed gains nothing about the lab.
- The unrelated sentinel appears **only** inside its own workspace (seed
  asserts the sentinel is present in Zed's read of that workspace and absent
  from every lab read). The capture tool hard-fails (writes nothing) if a
  forbidden string — credential-shaped tokens, user-home/system-temp absolute
  paths, either sprint's unrelated sentinel — survives redaction in a frame or
  summary.

## Recorded limitation (deliberate, keep with the fixture)

A naive uniform 3-cycle over the 58 fillers would put `~22` blocked tasks in
the lab. Because 22 blocked rows exceed the 20-row task page and blocked ranks
first, the page would consist entirely of blocked fillers: the keyed open task
`task_nav001_assigned_open_ana` would never be returned, so Ana's
`assigned_open_task` needs-you cue — a required member of the frozen key —
would silently vanish. The weighted cycle (`N % 13`) holds blocked fillers at
4 and in_progress fillers at 5 so the page is `7 blocked + 5 in_progress +
8 open` and keeps all six keyed tasks returned. Any redesign of the filler mix
must re-verify the page shape above, not just the ID list.

## Related evidence

- Step 0 v1.21.0 baseline captures: `docs/evidence/nav-001/baseline/BASELINE_PIN.md`
  (frames captured from a clean v1.21.0 worktree).
- Same-fixture v1.21.0 terminal behavior sanity record: the frame facts quoted
  in `BASELINE_PIN.md` and the capture summaries alongside the frames.
