# ATT-001 fixture — Trustworthy Team Attention (v1.18.0 baseline)

**FIXTURE EVIDENCE — calibrates UI and rubric; cannot establish Gate B, C, or E.**
This scenario is synthetic. It is not ordinary use, not human-comprehension
evidence, and not a verdict.

The frozen deterministic scenario for `docs/Campfire-v1.19-ATT-001-Trustworthy-Team-Attention.md`
§2 (baseline gaps) and §4 (frozen evaluation). It drives the real application
service with a fixed seed clock and a pinned id source, so two fresh runs
produce byte-identical served-state dumps.

## Scenario

One team, three humans, two owned agents, six workspaces:

| Workspace | Name | Layout |
| --- | --- | --- |
| `ws_att001_lab` | ATT-001 attention lab | Ana (owner), Ben (member), Codex (Ana's agent), OpenCode (Ben's agent); 1 goal, 21 tasks (20 returned, truncated), 3 findings (1 current, 1 superseded, 1 withdrawn), 7 accepted decisions returned (1 further decision superseded and excluded); no proposed decision since the scenario repair v2 |
| `ws_att001_quiet` | ATT-001 quiet desk | Ana + Ben; 3 tasks (complete), 1 accepted decision citing a current finding, 1 unassigned open task |
| `ws_att001_trunc_tasks` | ATT-001 truncated tasks | Ana + Ben; 22 tasks, 20 returned (in-progress fillers), open assigned task beyond the page |
| `ws_att001_trunc_decisions` | ATT-001 truncated decisions | Ana + Ben; 12 accepted decisions, 10 returned; the review decision is inside the page, the one citing a superseded finding is beyond it |
| `ws_att001_trunc_both` | ATT-001 truncated both | Ana + Ben; the task recipe of `trunc_tasks` combined with the decision recipe of `trunc_decisions` |
| `ws_att001_unrelated` | ATT-001 unrelated | Zed only; one finding carrying `UNRELATED_FINDING_SENTINEL_att001_do_not_leak` (never authorized to Ana or Ben) |

Keyed baseline facts (asserted by `seed.ts` before it writes its receipt):

- lab tasks `21 total / 20 returned / truncated`, with all five keyed tasks in
  the returned page; lab decisions `7 total / 7 returned / complete`.
- `dec_att001_review_superseded` (cites `find_att001_superseded`) and
  `dec_att001_review_withdrawn` (cites `find_att001_withdrawn`) are accepted,
  `needsReview = true`, with the exact non-current finding ids — and carry no
  attention cue in v1.18.0.
- `dec_att001_old` ends `superseded` (replaced by `dec_att001_new`, which is
  accepted with `predecessorId = dec_att001_old` and a recorded reason) and is
  excluded from the orientation decisions slice;
  `historicalCounts = { findings: 2, decisions: 1 }`.
- quiet: both humans `needsYou = []`, `needsAttention = []`, complete source
  pages, `suggestedNextAction` is the `team_open_task` fallback pointing at
  `task_att001_quiet_open`.
- lab (scenario repair v2): Ben has no assigned tasks and no My work attention cues while the lab
  task page is truncated (21 total / 20 returned), so his My work attention list
  is an **incomplete empty** — the direct H4 observation the trace workspace
  must provide. Ben's Team work attention list is non-empty, and Ana's lists stay
  nonempty and truncated.
- truncated workspaces: both humans `needsYou = []`, `needsAttention = []`
  while the corresponding slice reports `truncated = true`.

### Scenario repair v2 (October 15, 2026 local; October 16 UTC)

This fixture originally included a proposed decision in `ws_att001_lab`. Authoring
the answer key showed that it made both participants' attention lists nonempty,
so rubric H4's "does not interpret an incomplete empty list as team completion"
clause could not be directly observed in the single trace workspace. Before any
candidate result or human trace existed, the scenario was repaired by removing
the lab proposal (the contract §4 case set does not require one). The dated
record is `docs/evidence/att-001/baseline/SCENARIO_REPAIR.md`; the v1.18.0
baseline captures were re-produced fresh against this repaired fixture.

### Lifecycle note: `dec_att001_old`

The key asks for a replacement chain with `predecessorId = dec_att001_old`.
The only v1.18.0 path that records a successor with a predecessor link
(`addDecision({ replacesDecisionId })` + `acceptDecision(new, { reason })`)
requires the predecessor to be **accepted** at replacement time. The fixture
therefore records the standard lifecycle `proposed → accepted → superseded`;
the final keyed state (old superseded, excluded from orientation, new accepted
with predecessor and recorded reason) is exactly as specified. A proposed
decision can only be retired as `rejected`, which records no successor link.

## Layout

```
seed.ts      deterministic seed (--out <dir> --force); writes campfire.db,
             tokens.json (0600), seed-receipt.json under .tmp/
dump.ts      frozen-clock served-state dump (--db <path> [--tokens <path>] --out <dir>)
capture-viewer.ts  Playwright baseline/candidate capture (see below)
```

All outputs go to the gitignored `.tmp/`. No database or token is committed.

## How to run

```sh
# 1. Seed twice for the determinism proof.
#    Use --attention-expectation baseline only to re-assert the v1.18.0 served
#    attention shape in a v1.18.0 worktree; the default `none` seeds cleanly at
#    the candidate commit too (record-level facts are always asserted).
npx tsx fixtures/attention/att-001/seed.ts --out fixtures/attention/att-001/.tmp/run-a --force
npx tsx fixtures/attention/att-001/seed.ts --out fixtures/attention/att-001/.tmp/run-b --force

# 2. Dump both.
npx tsx fixtures/attention/att-001/dump.ts \
  --db fixtures/attention/att-001/.tmp/run-a/campfire.db \
  --tokens fixtures/attention/att-001/.tmp/run-a/tokens.json \
  --out fixtures/attention/att-001/.tmp/run-a/dump
npx tsx fixtures/attention/att-001/dump.ts \
  --db fixtures/attention/att-001/.tmp/run-b/campfire.db \
  --tokens fixtures/attention/att-001/.tmp/run-b/tokens.json \
  --out fixtures/attention/att-001/.tmp/run-b/dump

# 3. Determinism: must print nothing.
diff -r fixtures/attention/att-001/.tmp/run-a/dump fixtures/attention/att-001/.tmp/run-b/dump

# 4. Viewer capture (Playwright is not a repo dependency; run with the
#    external install and the cached Chromium).
NODE_PATH=/private/var/folders/b5/wj2djqx569x96bjvf5wclxf80000gn/T/opencode/att-001-pw/node_modules \
  npx tsx fixtures/attention/att-001/capture-viewer.ts \
  --db fixtures/attention/att-001/.tmp/run-a/campfire.db \
  --out fixtures/attention/att-001/.tmp/capture \
  --label baseline
```

`capture-viewer.ts` starts one in-process read-only Viewer per actor (port 0,
actor-bound dispatch, exactly like the SWH-001 integration helper), captures
screenshots and `#orientation` text for both perspectives, and then proves on a
**separate fresh seed instance** that Ana can still update
`task_att001_blocked_opencode` (the task cued to her under team attention while
assigned to `agt_att001_opencode`). The probe records the returned task and the
recorded contribution actor; a denied write is recorded verbatim instead.

## Determinism

- Ids: keyed records use the pinned ids in `SCENARIO`; every other record is
  `*_att001_0001`, `*_att001_0002`, ... in insertion order (`queueSource`).
- Clock: fixed base `2026-10-15T16:00:00.000Z`, +1000 ms per write; the dump
  reads at the frozen `SERVED_AT = 2026-10-15T18:00:00.000Z`.
- Exceptions: raw actor tokens are random by construction (`mintToken` uses
  WebCrypto). Token values and their stored hashes differ between runs; they
  never enter the dumps, and `dump.ts` fails if any dumped text contains
  `cft_`, `/Users/`, or the unrelated sentinel. The raw database also varies in
  `schema_migrations.applied_at` (wall-clock), invisible to the dumps.
- The write probe is intentionally not deterministic: it runs on a fresh
  instance with the real clock, because it is evidence of authorization, not of
  frozen state.

## Baseline captures

The committed baseline captures and the answers to "which contract §2 gap does
this reproduce" live in `docs/evidence/att-001/baseline/`. Do not hand-edit any
dump or capture; re-run the scripts.
