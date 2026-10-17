# ARH-001 fixture — Artifact Reference Handoff

**FIXTURE EVIDENCE — calibrates the frozen key; cannot establish Gate B, C, or E.**
This scenario is synthetic. It is not ordinary use, not human-comprehension
evidence, and not a verdict.

The frozen deterministic scenario for
`docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md` §3.1 (fixture/key
freeze) and the D1–D6 checks. It drives the real application service with a
fixed seed clock and a pinned id source, so two fresh runs produce
byte-identical served-state dumps.

## Scenario

One team, three humans, two owned agents on different harnesses, three
workspaces:

| Workspace | Name | Layout |
| --- | --- | --- |
| `ws_arh001_lab` | ARH-001 artifact handoff lab | Ana (owner), Ben (member), `agt_arh001_opencode` (Ana's agent, harness `opencode`), `agt_arh001_codex` (Ben's agent, harness `codex`); 1 goal, 6 tasks (complete), 3 current findings + 1 superseded, 5 returned accepted/proposed decisions + 1 superseded excluded, 7 artifacts (complete) |
| `ws_arh001_trunc_artifacts` | ARH-001 truncated artifacts | Ana + Ben; 12 artifacts (10 returned, truncated, `nextCursor` present); 1 finding linking a returned artifact |
| `ws_arh001_unrelated` | ARH-001 unrelated | Zed only; one finding carrying `UNRELATED_FINDING_SENTINEL_arh001_do_not_leak` (never authorized to Ana or Ben) |

The lab carries the seven ARH-001 reference classes as artifacts:

| Artifact | Type | Reference class | Stored `uriOrPath` |
| --- | --- | --- | --- |
| `art_arh001_safe_output` | `report` | safe HTTPS (the recorded chain source) | `https://example.com/arh-001/q3-handoff-analysis.html` |
| `art_arh001_safe_old_report` | `report` | similar/historical distractor | `https://example.com/arh-001/q3-handoff-analysis-draft.html` |
| `art_arh001_stale` | `deployment` | stale/denied target | `https://example.com/arh-001/deployments/old-preview` |
| `art_arh001_path` | `document` | inert local path | `reports/arh-001/working-notes.md` |
| `art_arh001_insecure_scheme` | `file` | non-HTTPS scheme | `ftp://files.example.com/arh-001/export.tar.gz` |
| `art_arh001_credentialed` | `other` | credential-bearing reference | `https://arh001-demo-user:arh001-demo-pass@example.com/arh-001/private-view` |
| `art_arh001_hostile_markup` | `other` | hostile markup | `https://example.com/arh-001/report"><img src=x onerror=alert(1)>` |

The stored strings are what `normalizeArtifactUri` produces (schemes other than
`file:` and relative paths are stored verbatim); the seed asserts both the
normalizer output and the stored row for each of the seven.

Keyed facts (asserted by `seed.ts` before it writes its receipt):

- lab artifacts `7 total / 7 returned / complete`; the cited artifact
  `art_arh001_safe_output` ranks first (`ARTIFACT_RANK_SQL`), the rest order by
  `created_at DESC`: `hostile_markup`, `credentialed`, `insecure_scheme`,
  `path`, `stale`, `safe_old_report`.
- lab tasks `6 total / 6 returned / complete` with
  `task_arh001_followup` open and assigned to `agt_arh001_codex`; Codex's
  `needsYou` is exactly `[{ reason: "assigned_open_task", id: task_arh001_followup }]`
  and its suggested next action points at the same task.
- lab findings `3 total / 3 returned / complete` (current-only slice):
  `find_arh001_current` (by `agt_arh001_opencode` through
  `ses_arh001_opencode`, `sourceArtifactId = art_arh001_safe_output`, evidence
  `fev_arh001_current_supports` relation `supports`),
  `find_arh001_contradicts` (by `agt_arh001_codex` through
  `ses_arh001_codex`, evidence `fev_arh001_contradicts_stale` relation
  `contradicts` to `art_arh001_stale`), and `find_arh001_superseded_fix`
  (successor of `find_arh001_superseded`).
- lab decisions `5 total / 5 returned / complete` in order
  `[new, competing_b, competing_a, review, current]`; the superseded
  `dec_arh001_old` is excluded; `historicalCounts = { findings: 1, decisions: 1 }`.
- `dec_arh001_current` accepted, citing `find_arh001_current` via
  `cit_arh001_current_basis`; `dec_arh001_review` accepted, `needsReview = true`
  with `needsReviewFindingIds = [find_arh001_superseded]`, citing it via
  `cit_arh001_review_basis`; `dec_arh001_competing_a` and
  `dec_arh001_competing_b` are both accepted with conflicting substance and no
  recorded transition; `dec_arh001_old` ends `superseded` with
  `successorId = dec_arh001_new`, and `dec_arh001_new` is accepted with
  `predecessorId = dec_arh001_old` and a recorded supersede reason.
- trunc artifacts `12 total / 10 returned / truncated` with `nextCursor`;
  `art_arh001_beyond_page` (no finding link, oldest creation) and
  `art_arh001_trunc_older` sit beyond the returned page; the returned page is
  `[art_arh001_trunc_linked, filler 09 … filler 01]`, and the finding
  `find_arh001_trunc` links the returned `art_arh001_trunc_linked`.
- unrelated: the sentinel appears only in Zed's own read and in no authorized
  lab/trunc read; Zed is denied a lab read with `ParticipantRequired` and no
  lab title, reference, or count in the error.
- both agents are participants of the lab with their actual harness values
  (`opencode` on `agt_arh001_opencode`, `codex` on `agt_arh001_codex`) and each
  has a registered session (`ses_arh001_opencode`, `ses_arh001_codex`).

### Lifecycle note: `find_arh001_superseded`

The corrected finding starts as the original reading (`addFinding`), then
`correctFinding` records the successor `find_arh001_superseded_fix` with a
reason. Per COR-001 the original text stays in place (`currentness =
superseded`, `successorId` set); a decision citing the original reads back with
`needsReview` and does not replay in the current findings slice.

### Lifecycle note: `dec_arh001_old`

The key asks for a replacement chain with `predecessorId = dec_arh001_old`.
The only path that records a successor with a predecessor link
(`addDecision({ replacesDecisionId })` + `acceptDecision(new, { reason })`)
requires the predecessor to be **accepted** at replacement time. The fixture
therefore records the standard lifecycle `proposed → accepted → superseded`;
the final keyed state (old superseded, excluded from orientation, new accepted
with predecessor and recorded reason) is exactly as specified.

## Layout

```
seed.ts      deterministic seed (--out <dir> --force); writes campfire.db,
             tokens.json (0600), seed-receipt.json under .tmp/
dump.ts      frozen-clock served-state dump (--db <path> [--tokens <path>] --out <dir>)
```

All outputs go to the gitignored `.tmp/`. No database or token is committed.

## How to run

```sh
# 1. Seed twice for the determinism proof.
npx tsx fixtures/artifact-handoff/arh-001/seed.ts --out fixtures/artifact-handoff/arh-001/.tmp/run-a --force
npx tsx fixtures/artifact-handoff/arh-001/seed.ts --out fixtures/artifact-handoff/arh-001/.tmp/run-b --force

# 2. Dump both.
npx tsx fixtures/artifact-handoff/arh-001/dump.ts \
  --db fixtures/artifact-handoff/arh-001/.tmp/run-a/campfire.db \
  --tokens fixtures/artifact-handoff/arh-001/.tmp/run-a/tokens.json \
  --out fixtures/artifact-handoff/arh-001/.tmp/run-a/dump
npx tsx fixtures/artifact-handoff/arh-001/dump.ts \
  --db fixtures/artifact-handoff/arh-001/.tmp/run-b/campfire.db \
  --tokens fixtures/artifact-handoff/arh-001/.tmp/run-b/tokens.json \
  --out fixtures/artifact-handoff/arh-001/.tmp/run-b/dump

# 3. Determinism: must print nothing.
diff -r fixtures/artifact-handoff/arh-001/.tmp/run-a/dump fixtures/artifact-handoff/arh-001/.tmp/run-b/dump
```

`dump.ts` binds every fixture actor directly (or through their token when
`--tokens` is supplied, exactly as the CLI/Viewer binding does) and writes:

- `whoami-<actor>.json` for all five actors;
- `context-<wsId>-<actor>.json` and `workspace-<wsId>-<actor>.json` for every
  readable combination: Ana and Ben over the lab and truncated-artifacts
  workspaces, both agents over the lab;
- `denials.json` capturing Zed → lab (`ParticipantRequired`), Ana → unrelated
  (`ParticipantRequired`), Ana → unknown workspace (`WorkspaceNotFound`), and a
  trunc-workspace artifact id addressed through the lab route
  (`ArtifactNotFound`) — each with the error name/code/message and no leaked
  facts;
- `dump-summary.json` with per-file sha256 and the page `total` / `returned` /
  `truncated` / `nextCursorPresent` for tasks, findings, decisions, artifacts,
  and recent changes per dumped slice.

The unrelated workspace is deliberately never dumped: its finding carries the
sentinel, and `dump.ts` hard-fails if any dumped text contains `cft_`,
`/Users/`, or the sentinel.

## Determinism

- Ids: keyed records use the pinned ids in `SCENARIO` (including the two
  evidence rows and two citation rows); every other record is
  `*_arh001_0001`, `*_arh001_0002`, ... in insertion order (`queueSource`).
- Clock: fixed base `2026-10-16T16:00:00.000Z`, +1000 ms per write; the dump
  reads at the frozen `SERVED_AT = 2026-10-16T18:00:00.000Z`.
- Exceptions: raw actor tokens are random by construction (`mintToken` uses
  WebCrypto). Token values and their stored hashes differ between runs; they
  never enter the dumps, and `dump.ts` fails if any dumped text contains
  `cft_`, `/Users/`, or the unrelated sentinel. The raw database also varies in
  `schema_migrations.applied_at` (wall-clock), invisible to the dumps and the
  receipt.
