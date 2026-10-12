# RCL-003 run lock — October 11, 2026

Scored runs have not started. This file freezes the harnesses, models, budgets, arm order, and seed facts before any scored run. It does not record a score.

## Frozen settings

| Item | Value |
| --- | --- |
| Control source | `bb3bb61d716f52bb36e5f1c6e6514ece71abc555` (`recall_workspace` is absent) |
| Treatment source | `PLACEHOLDER_NOT_YET_COMMITTED_0000000000000000` |
| Package | `1.15.0` |
| Matched harness | Codex `0.150.1` at `/Users/sergio/.local/bin/codex` |
| Matched model | `gpt-5.6-sol` |
| Matched reasoning | `high` |
| Recipient harness | OpenCode `2.0.26` at `/Users/sergio/.opencode/bin/opencode` |
| Recipient model | `opencode-go/glm-5.2#max` |
| Pilot root | `~/.campfire-pilot/rcl-003` (outside the repository) |
| Arm order | S1 control, then treatment, then recipient; S2 treatment, then control, then recipient; S3 control, then treatment, then recipient |
| Matched budget | 20 minutes or 40 tool calls, whichever comes first |
| Recipient budget | 10 minutes or 20 tool calls, whichever comes first |

### The treatment source hash is a placeholder

`PLACEHOLDER_NOT_YET_COMMITTED_0000000000000000` is not a commit. The decision-set implementation is not committed yet, so there is no hash to freeze. The runner refuses to start while this string is in place, before it checks the product tree, the seed, the sandbox, or the models.

The real hash is recorded here by a **dated amendment** after the implementation is committed and before the first scored arm runs. The amendment names the commit, the date, and the person recording it, and it changes nothing else in this table: not the control commit, not the harness versions, not the models, not the budgets, not the arm order, not the pilot root, not the scenarios, not the key, not the rubric. If the implementation commit changes after that amendment, the amendment is void and the pilot restarts from preflight with a new dated amendment. Editing this table silently to match a later tree is a locked violation, not an amendment.

## Why these harnesses and models

The harness versions and model ids are copied unchanged from RCL-002 so the two pilots compare like with like. `~/.codex/config.toml` names `gpt-6-sol`; RCL-001 recorded that this ChatGPT account rejects that id and that `gpt-5.6-sol` at `high` replied READY. Keep `gpt-5.6-sol`. RCL-001 locked a recipient on `opencode/space-bunny-free#xhigh`, and RCL-002 recorded `FreeTierError` 403 from `opencode run` on October 11, 2026, because the free tier can only be used from within OpenCode. The recipient stays `opencode-go/glm-5.2#max`. Do not edit the RCL-001 or RCL-002 locks.

## Seed process

The seed opens a new SQLite file outside the repository and runs the real service with a caller-chosen id source. It pins every id in `ground-truth.md` with fresh `rcl003` ids and asserts the queue drained. Seeded agents use harness `fixture` and no model. `hum_rcl003_reader` is the viewer recipient and authors nothing in the key.

The seed self-verifies against `deriveDecisionSetState`'s real output before returning, and asserts the set is identical under `limit: 1` paging.

### Seed facts frozen before the first scored run

These are what `assertSeedFacts` re-checks at every preflight. They are facts about the fixture, not about an arm's answer.

| Scenario | Workspace | Decisions | Orientation decision slice | Keyed off first page | Orientation-absence string | Decision set state | Decision set members (lifecycle) | `operativeDecisionId` | `beforeActing` | `recordedTransitions` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | `ws_rcl003_s1` | 12 accepted, 1 proposed, 0 superseded | `total` 13, `returned` 10, `truncated` true | `dec_rcl003_s1_fixed`, `dec_rcl003_s1_rolling` | `thirty minutes` | `unresolved-accepted-decisions` | `dec_rcl003_s1_proposed` (proposed), `dec_rcl003_s1_fixed` (accepted), `dec_rcl003_s1_rolling` (accepted) | absent | present, the frozen literal | empty |
| S2 | `ws_rcl003_s2` | 12 accepted, 1 proposed, 1 superseded | `total` 13, `returned` 10, `truncated` true | `dec_rcl003_s2_predecessor`, `dec_rcl003_s2_replacement` | `two-hour outage` | `linked-accepted-decisions` | `dec_rcl003_s2_replacement` (accepted), `dec_rcl003_s2_predecessor` (superseded), `dec_rcl003_s2_proposed` (proposed) | `dec_rcl003_s2_replacement` | absent | one pair, predecessor → replacement |
| S3 | `ws_rcl003_s3` | 9 accepted, 1 proposed, 0 superseded | `total` 10, `returned` 10, `truncated` false | none required | none; no accepted decision states a row count | `no-accepted-decision` | `dec_rcl003_s3_proposed` (proposed) | absent | absent | empty |

Every decision set is `total` = `returned` = 3, 3, 1 and `truncated` false, so no scenario can be reported safe because it was cut. The default `list_decisions` page is 10 rows in every scenario and never contains a keyed off-page decision. S1 and S2 each hold twelve accepted decisions and one proposal, so orientation reserves the proposal slot and returns nine newer accepted decisions plus that proposal out of `total` 13. Both scenarios seed their keyed decisions first and their fillers afterwards, so every keyed row has at least ten strictly newer accepted decisions and cannot reach either first page; equal timestamps would not be sufficient, because a tie sorts by id ascending. In S2 that applies to both the survivor and the decision it replaced, so the counter-case cannot be answered from the unassisted view without a paginated hunt. S2 records its transition before its fillers and its housekeeping work, so the supersession is not the newest change either. Later completed work pushes the keyed ids and the recorded supersession out of the first `recentChanges` slice and the provenance summaries.

Replacing an existing seed requires `--force`. The seed writes no file inside the repository and refuses a symlinked output path.

## Arm prompts

The runner reads `scenarios.md` and passes one string to the harness. It does not mount this directory. The control addendum omits the recall query. The treatment addendum names `recall_workspace` and the scenario query. Both addenda forbid `get_workspace` and writes. The recipient addendum names `packet.json` and forbids a Campfire credential. The three addenda are byte-identical to RCL-002's; the product's own tool description and session instructions are what name the decision set to an agent, and this pilot does not add product knowledge to a prompt.

The packet is produced by `campfire handoff-packet` from a copy of the seed database before the recipient starts. The issuer is the scenario owner. The recipient actor is `hum_rcl003_reader`.

## Isolation

Follow `isolation.md`. The runner refuses to start while `src/`, `package.json`, or `package-lock.json` disagrees with the treatment commit, while an untracked product file exists, while the installed harness versions disagree with this file, or while this file is missing any frozen value above.

## Attempt discipline

An empty answer is an invalid attempt. The runner keeps that directory with an `-invalid` suffix and repeats the arm once. A second empty answer stops the pilot. A completed answer is not repeated. Do not delete a completed run to force a rerun. An arm that overruns its tool-call or time budget, calls `get_workspace`, reaches into another arm's private state, or leaves the decision set unengaged is recorded in `invalidForScoring` and reported as recorded. The decision-set check never triggers a rerun.

## After the first scored run

Do not edit this file, `ground-truth.md`, `scenarios.md`, `rubric.md`, or `isolation.md` to fit an output. Record a deviation instead. Do not rescore or rerun RCL-001 or RCL-002, and do not edit either frozen fixture tree.