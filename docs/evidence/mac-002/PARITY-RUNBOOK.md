# MAC-002 PARITY RUNBOOK — Gate S1 (semantic parity across surfaces)

Status: **runbook only. No test result is recorded here.** A code change or a
script pass is not the two-Mac exit (`docs/evidence/mac-002/SCOPE.md`), and
this file does not claim a toolkit verdict.

This runbook turns the machinery in `prototypes/mac-002/parity.ts` + this
human checklist into the MAC-001B/MAC-002 evidence the strategy doc requires.

## The gate this satisfies

`docs/Campfire-Multi-Surface-Strategy.md` — Evidence gate S1 (Semantic parity):

> "For the same authorized actor and workspace, every surface agrees on record
> IDs, currentness, attribution, decision state, counts, truncation, and
> source links. No UI repairs or reinterprets a domain ambiguity locally."

`docs/evidence/mac-001b/VERDICT.md` — HOLD preconditions (verbatim list):
1. A user-started Viewer with listener ownership checked.
2. The same workspace/task/finding IDs and counts from Viewer + SwiftUI + GPUIX.
3. An accessibility tree or VoiceOver pass reaching Refresh and the selected
   record in the GPUIX window.
4. A recorded decision that the retained native patch stack is worth the result.

## Pre-flight (operator)

1. Run `campfire up` yourself. Verify the receipt's `viewerUrl`
   (`http://127.0.0.1:9415`) and that no second Campfire is already bound to
   9414/9415 (`campfire doctor` or `campfire status --output json`).
2. Leave the machine calm — no other harvests/imports while anything runs.

## Step 1 — scripted three-snapshot parity (machine)

```bash
cd Campfire-Internal
bun prototypes/mac-002/parity.ts --workspace <the shared workspace id>
```

Expected: exit 0, "A==B compared N, diffs 0", every A==C cell PASS or SKIP.
Record the printed table and the artifact path in `docs/evidence/mac-002/`
(RESULT file created at run time). If exit 1: do NOT paper over it — a DIFF is
a factual disagreement; the repair lands in the surface that reinterpreted the
record, and the run is repeated.

## Step 2 — GUI checklist (human, both native surfaces open on the same read)

For **each** of the following, GPUIX (`campfire-desktop/apps/gpuix`, `bun run
dev:app`) and the SwiftUI prototype (`prototypes/mac-001`):

- [ ] Same workspace id and name visible; goal title and status agree.
- [ ] Work: task ids and statuses agree with the CLI `tasks` output.
- [ ] Sources: finding ids and `currentness` agree; artifacts show type and
      the stored-reference caveat only.
- [ ] Decisions: proposed/accepted/superseded bands agree; `needs review`
      appears only where the service decorated it; `Campfire` is not silently
      selecting an operative decision.
- [ ] People & Agents: humans and agents remain distinct; agent rows name
      their human owner; nothing is inferred from activity.
- [ ] Needs You: reason codes shown as the stable labels; counts disclose
      truncation (`returned` of `total`).
- [ ] Activity: ordering and provenance come from the canonical contribution
      history; contribution positions shown are the same append positions the
      CLI reports (`changes`).
- [ ] Stale/unreachable: stop `campfire up`; the surface keeps the last
      projection **only with an explicit STALE label**.
- [ ] Denied / revoked: revoke the actor's access on the second profile (or
      point a second viewer at a workspace this actor is not on); the affected
      desktop **clears the workspace** instead of showing stale authorized data
      ("revoked access clears or visibly invalidates retained projections").
- [ ] Incomplete: a truncated slice shows returned-of-total and never
      summarizes unauthorized records.

Record IDs/counts as text in the RESULT doc; screenshots are supplements,
not the evidence.

## Step 3 — accessibility pass (human)

- [ ] VoiceOver (or Accessibility Inspector) reaches **Refresh** by keyboard.
- [ ] VoiceOver reaches the **selected record** and reads its attribution line
      (who recorded it, via which agent session).
- [ ] The rail exposes Workspaces / Needs You / People & Agents in the tree.

## Step 4 — record the verdict inputs

Write `docs/evidence/mac-002/RESULT.md` (from the template below). The
scripted pass satisfies only **precondition 2**'s Viewer/GPUIX/CLI legs; the
SwiftUI leg, the accessibility pass (3), and the patch-stack decision (4) come
from the human steps. MAC-001B's verdict (GPUIX / SwiftUI / HOLD) is then
recorded in `docs/evidence/mac-001b/VERDICT.md` by a separate dated addendum —
not by editing the HOLD text.

## RESULT template

```markdown
# MAC-002 RESULT — surface parity run

- Date / machine:
- Viewer version (GET /health) / CLI version:
- workspaceId:

| Check | Viewer | GPUIX client | CLI | SwiftUI | Verdict |
| --- | --- | --- | --- | --- | --- |
| workspace id/name |  |  |  |  |  |
| task ids/counts |  |  |  |  |  |
| finding ids/currentness |  |  |  |  |  |
| decision bands/needs review |  |  |  |  |  |
| artifact ids/type |  |  |  |  |  |
| attention reason ids |  |  |  |  |  |
| returned/total/truncated |  |  |  |  |  |
| contribution positions |  |  |  |  |  |

- parity artifact: prototypes/mac-002/out/<snapshot json>
- stale / denied / revoked observations:
- accessibility observations:
- Two-Mac screen: NOT OBSERVED (separate gate)
```
