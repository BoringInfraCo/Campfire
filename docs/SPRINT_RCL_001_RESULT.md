# RCL-001 result

**Status:** NO-GO on the frozen synthetic pilot. Implemented candidate. Not a release.

**Date:** October 11, 2026

**Package version:** `1.15.0` (unchanged)

**Contract:** `docs/Campfire-v1.16-RCL-001-Recall-and-Portable-Handoff.md`

**Candidate:** `b6fc55865244ef4fc82db2d46c42b633f4017ab0`

**Pilot lock:** `b79cc4d` in `fixtures/recall/rcl-001/RUN-LOCK.md`, frozen before these runs

## Verdict

The October 11 scored pilot is **NO-GO** under contract §8.

The three Recall arms identify the relevant history, or its insufficiency, and none of them states a superseded finding as current. That clause is met. The rest of the GO bar is not:

- Zero of three offline recipients pass the packet rubric.
- Zero of three Recall arms make a better justified next-action choice than the matched orientation arm. S1, S2, and S3 each make the same choice in both arms.
- No ordinary-work observation is available, so Gate E stays open.

CONDITIONAL GO requires the deterministic checks and the synthetic pilot to pass, with ordinary-work evidence unavailable or with the orientation arms already at the rubric ceiling. The synthetic pilot includes the three packet recipients. Those arms did not pass, so CONDITIONAL GO is not available. The orientation arms are close to the keyed next action on S1 and S2, and that unproven difference remains unproven.

This NO-GO is the evidence result. The three written packets are mode `0600`, contain no `cft_` credential, and contain no filesystem path. No matched answer promotes a superseded finding into current evidence. Gate B, Gate C, and Gate E stay unmeasured. Publication and deployment stay unmade.

## What the code adds

One authorized recall read on CLI, MCP, and HTTP, and one CLI-written private handoff packet. Selection is `rcl-1`. No contribution is written. Viewer and telemetry allow-lists are unchanged.

Working-tree checks on October 10, 2026, before the candidate commit: `tsc --noEmit` passed, and `vitest run` passed 1001 tests across 84 files. Those checks were not rerun for this pilot. The §6 release checks (build, packaging, deployment dry run, public export, and install channels) were not run. The package remains `1.15.0`.

## 1. Frozen setup

The lock, seed, and runner were committed in `b79cc4d` before the first scored arm. The scored run did not edit `ground-truth.md`, `scenarios.md`, `rubric.md`, `isolation.md`, or `RUN-LOCK.md`. Those files still contain their pre-run sentences. This result is the record that the run happened.

| Locked item | Value used |
| --- | --- |
| Orientation source | `bb3bb61d716f52bb36e5f1c6e6514ece71abc555` |
| Recall source | `b6fc55865244ef4fc82db2d46c42b633f4017ab0` |
| Matched harness | Codex CLI `0.150.1`, model `gpt-5.6-sol`, reasoning `high` |
| Recipient harness | OpenCode `2.0.26`, model `opencode/space-bunny-free#xhigh` |
| Matched budget | 20 minutes or 40 tool calls |
| Recipient budget | 10 minutes or 20 tool calls |
| Arm order | S1 orientation, Recall, recipient; S2 Recall, orientation, recipient; S3 orientation, Recall, recipient |
| Seed | `npx tsx fixtures/recall/rcl-001/seed.ts`, output outside the repository |

Each matched arm received a fresh session, its own database copy, its own credential, and the scenario prompt. Recall arms also received the locked recall query. Recipients were supposed to receive only `packet.json` and the continuation paragraph. The packets were written by `campfire handoff-packet` before the recipient process started.

## 2. Run execution

All nine arms ran once on October 11, 2026, from `2026-10-11T04:10:06Z` through `2026-10-11T04:14:27Z`. The runner logged `PILOT_DONE`. There were no empty answers and no replacement runs. Raw logs, databases, tokens, and packets remain under the private pilot root `~/.campfire-pilot/rcl-001/`. They are not committed.

| Order | Arm | Stop | Exit | Tool calls | Recall calls | Answer bytes |
| ---: | --- | --- | ---: | ---: | ---: | ---: |
| 1 | S1 orientation | completed | 0 | 8 | 0 | 713 |
| 2 | S1 Recall | completed | 0 | 3 | 1 | 638 |
| 3 | S1 recipient | completed | 0 | 14 | 0 | 5006 |
| 4 | S2 Recall | completed | 0 | 3 | 1 | 444 |
| 5 | S2 orientation | completed | 0 | 7 | 0 | 508 |
| 6 | S2 recipient | completed | 0 | 5 | 0 | 2397 |
| 7 | S3 orientation | completed | 0 | 7 | 0 | 590 |
| 8 | S3 Recall | completed | 0 | 3 | 1 | 443 |
| 9 | S3 recipient | tool budget | 130 | 20 | 0 | 87 |

Orientation tool lists are `list_workspaces`, `get_workspace_context`, catch-up, and drill-down reads. S3 orientation also called `whoami`. Recall tool lists are `list_workspaces`, `get_workspace_context`, and one `recall_workspace`. No matched arm called a Campfire write tool.

## 3. Recipient isolation deviation

The runner spawned each recipient with its working directory set to that arm's private `work/` directory, where `packet.json` had already been written. OpenCode operated in the Campfire repository instead. The `bash` and `edit` denies in the private `opencode.json` did not apply. Seatbelt denied reads of `docs/`, `evidence/`, and `fixtures/`. It allowed reads of `src/` and `tests/`.

Event scans of all three recipient logs have zero hits for `ground-truth.md`, `scenarios.md`, `seed.ts`, `rubric.md`, `RUN-LOCK.md`, and another arm's `answer.txt`. No recipient made a Campfire tool call.

- S1 searched the repository and the home directory, read handoff implementation lines under `src/`, and then read its own packet. The answer names that absolute packet path. The packet's accepted-decision text is the summary, "Authenticate partner callbacks with an HMAC of the raw body." The packet has no rationale field and does not contain the twenty-four hour overlap sentence. The answer then refuses implementation and asks for a live catch-up. It also calls sessions `ses_rcl001_s1_a` and `ses_rcl001_s1_b` two agents. Those sessions belong to one agent, `agt_rcl001_s1`.
- S2 searched the repository, parent directories, and the home directory at shallow depth. It never read a packet. It refused to invent the five fields.
- S3 stopped at the 20-call budget while still searching. It never read a packet. One search opened `tests/unit/rcl-001-service.test.ts`. The scored sentence does not use that file. Reads of `docs/` returned "Operation not permitted."

A recipient who lacked the packet cannot pass. A recipient who searched the repository is not the specified packet-only arm. Neither fact is a reason to edit the key or to rerun the arm.

## 4. Scores

Two scorers scored the six matched answers without arm labels. They agreed on every R1–R4 item and on every scenario fail line. They disagreed only on the S1 comparison. Resolved against the key: both S1 answers choose the same next action, implementation of the accepted raw-body HMAC with the twenty-four hour overlap. The orientation answer also calls the open task stale, which fails R2 and does not create a different next action.

R1 fails on every matched answer because the verbatim text cites no object id. R3 and R4 pass on every matched answer. The S1, S2, and S3 fail lines are untriggered: no matched answer follows the superseded callback finding or the query-string proposal, treats keyless retry as ready to execute, or states the partner limit as decided.

| Arm | R1 | R2 | R3 | R4 | Next action against the key |
| --- | --- | --- | --- | --- | --- |
| S1 orientation | fail | fail | pass | pass | Same HMAC action. Calls the open task stale. |
| S1 Recall | fail | pass | pass | pass | Same HMAC action. Leaves the proposal unaccepted and the task open. |
| S2 orientation | fail | pass | pass | pass | Same pause. Accepted decision tied to a superseded finding. No replacement rule. |
| S2 Recall | fail | pass | pass | pass | Same pause. States `needsReview`. No replacement rule. |
| S3 orientation | fail | pass | pass | pass | Limit stays undecided. Proposal stays proposed. Two seconds is not treated as a rate. |
| S3 Recall | fail | pass | pass | pass | Same undecided limit and unaccepted proposal. |

The S3 next-action sentences ask the owner to confirm the proposed 100 requests/second. Both scorers read that as leaving the limit unset and preserving uncertainty. The scenario fail line stays untriggered because neither answer states the number as decided.

Packet fields, scored from the verbatim answers and the access log:

| Continuation | Goal | Prior evidence | Decision status | Next action | Uncertainty | Whole rubric |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | pass | pass | pass | fail | fail | fail |
| S2 | fail | fail | fail | fail | fail | fail |
| S3 | fail | fail | fail | fail | fail | fail |

S1 states the goal, the current and superseded findings with their sessions, and the accepted decision versus the unaccepted proposal. Its next action is live verification rather than implementation of the accepted HMAC. Its uncertainty adds mechanism details the key does not require, and it collapses two sessions into two agents. S2 and S3 fail every field because they did not read a packet.

## 5. What this establishes

The candidate can serve the locked Recall read and can write a private packet for these three seeded workspaces. On this synthetic pair, orientation and Recall reach the same keyed next action. The offline recipient path did not run as specified, so this pilot does not show that a later harness can continue from the packet alone.

The unproven benefit is a material change in the next action, or in preserved uncertainty, from Recall or from the packet. Gate E remains open. A synthetic fixture does not establish Gate B or Gate C.

## 6. Left unchanged

`package.json` stays `1.15.0`. No tag, public snapshot, or production deploy was made. The frozen fixture files were not edited to fit these answers. Embeddings, Viewer writes, packet import, and per-command telemetry were not added.
