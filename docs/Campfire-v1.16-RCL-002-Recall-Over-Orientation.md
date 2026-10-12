# Campfire v1.16 — Recall over orientation

- **Sprint ID:** RCL-002
- **Target release:** none. v1.16 stays held. Package remains `1.15.0`.
- **Status:** Preregistered October 11, 2026. Scored runs have not started. This is not a verdict and not a release.
- **Prior result:** `docs/SPRINT_RCL_001_RESULT.md` stays frozen. Its verdict is NO-GO. Do not rescore those nine runs and do not rerun them to change that verdict.

## Preregistration corrections — October 11, 2026

Recorded before any scored arm and before the seed exists. These corrections do not reopen RCL-001 and do not release v1.16.

1. **S2 key.** The first key told a scorer to follow the older accepted checkout decision. Both of those decisions remain accepted. `needsReview` does not revoke one, and Campfire does not define an operative decision among accepted decisions. A decision becomes superseded through `retireDecision`, or when a proposed replacement names that predecessor and is accepted with a reason. The key now requires the arm to surface the conflict and seek one of those transitions. No replacement was seeded.
2. **Recipient write deny.** The profile denied checkout reads for both path spellings and checkout writes for the original spelling only. `fixtures/recall/rcl-001/run.ts` and `fixtures/recall/rcl-002/diagnose.ts` now deny writes for the lowercased spelling as well. The unscored diagnostic was rerun after that edit. It remains unscored.
3. **Committed key and harness history.** An unscored runner preflight showed that denying `fixtures/` alone still allowed `git show` to read the committed key through `.git`. The matched and recipient profiles now deny `.git` in both checkout spellings. The recipient profile also denies the host OpenCode config, data, and state directories; a new per-arm database contains only copied routing and authentication rows, with history tables asserted empty. The locked models replied READY after this change. See `fixtures/recall/rcl-002/isolation.md` for the preflight checks. This changes the isolation implementation before scoring, not the comparison or answer key.

## 1. Question

RCL-001's matched arms reached the same next action because the keyed decision was already on the first orientation read. RCL-002 asks whether Recall changes that next action when an accepted decision is absent from the first orientation page and from the default decision drill-down page. For S1 that hidden decision is the accepted rule. For S2 it is a second accepted decision, and the next action is to surface the conflict rather than choose between two accepted decisions.

A control that pages further, or that raises the page limit, can still read the record. The measured question is whether it does so inside the same budget. A control that reaches the same choice has matched Recall. That outcome is allowed. It is not repaired after the run.

## 2. What this pilot inherits

The recall read, `rcl-1` ordering, and the CLI packet remain the RCL-001 candidate. After the October 11 NO-GO, two corrections were added for the next measurement:

- A decision record in the packet, and a proposed or accepted decision anchor, carries the stored rationale when one exists. The bound is 1024 bytes. Truncation sets `rationaleTruncated`. The live recall response stays an excerpt and does not gain a rationale field. `HANDOFF_PACKET_SCHEMA_VERSION` stays 1.
- A future recipient sandbox denies reads and writes of the Campfire checkout, including the lowercased checkout path, and sets `PWD` to the arm directory. Matched arms still launch the local MCP server from the checkout.

Those corrections do not reopen RCL-001. The scored RCL-001 candidate remains `b6fc55865244ef4fc82db2d46c42b633f4017ab0`. RCL-002 treatment source is the commit that contains the rationale bound. The run lock records that hash before the first scored run. Control source remains `bb3bb61d716f52bb36e5f1c6e6514ece71abc555`, which has no `recall_workspace`.

On October 11 an unscored diagnostic, `npx tsx fixtures/recall/rcl-002/diagnose.ts`, confirmed one fresh OpenCode process read only `packet.json` and replied with that packet's decision rationale. The event log showed no checkout read and no Campfire tool call. The model was `opencode-go/glm-5.2#max`. The packet was one decision. This check is not a score.

## 3. Comparison

Three workspaces. Each has a Codex control arm, a Codex treatment arm, and an OpenCode recipient. Prompts and queries are `fixtures/recall/rcl-002/scenarios.md`. The answer key is `fixtures/recall/rcl-002/ground-truth.md`. The seed script is written only after this preregistration is in the tree, and only before the first scored run.

Control addendum, after the task prompt:

> Use orientation, catch-up, and drill-down. Do not call get_workspace. Do not write or update Campfire records.

Treatment addendum, after the task prompt and `Recall query: <the scenario query>`:

> Use recall_workspace with that query before you answer. You may also use orientation, catch-up, and drill-down. Do not call get_workspace. Do not write or update Campfire records.

The control prompt does not include the recall query. Neither prompt includes the answer key.

`get_workspace` returns the full inspector, including every decision rationale. A matched arm that calls it has left the orientation path. Score the answer, mark the pair inconclusive, and do not count it as better or as no-worse. Do not rerun the arm.

`get_workspace_changes` continues forward from the orientation cursor. It does not walk older history. Older decisions are reached with `list_decisions` and `get_decision`.

### Why the first page can omit the older decision

Orientation uses `DEFAULT_CONTEXT_BUDGET.decisions` of 10. When the workspace has at least one accepted decision and at least one proposed decision, one slot is reserved for a proposal, so the first page holds at most 9 accepted decisions plus that proposal. Accepted decisions sort newest `updated_at` first, then id ascending. `list_decisions` with the default limit of 10 returns the 10 newest decisions in that same rank order, so the first drill-down page is the 10 newest accepted decisions when at least 10 accepted decisions exist. A limit of 100 can still reach an older row. The maximum page size is 100.

S1 and S2 therefore need 11 accepted decisions: one older accepted decision, and 10 newer accepted decisions. The seed clock must give the older decision a strictly earlier `updated_at`. Equal timestamps sort by id ascending, which would pull a lower id onto the first page. S1's only proposal is the unaccepted partner-callback alternative, so the reserved slot shows that alternative. S1's older decision is the one accepted rule. S2's only proposal is unrelated to checkout retry, so the reserved slot does not add another checkout rule. S2's newest accepted decision needs review. S2's older checkout decision is also accepted. Neither supersedes the other.

The older S1 and S2 decisions must also be absent from the orientation `recentChanges` slice and from the provenance summaries. Those slices are the newest material rows inside the newest 100 contributions, capped at 20, and the newest 20 contributions. The seed creates enough later contributions that the first orientation payload omits that older id. Catch-up from that cursor must not be required to see it.

S3 keeps 9 accepted decisions on other topics and one proposal. Its decision slice fits on the first page. S3 checks that Recall is no worse when the history is insufficient. It is not a place to look for a Recall win.

Filler text must not contain the scenario query or the orientation-absence string named in the key. The current finding named in the key stays inside the findings budget of 10. That finding does not state the S1 rationale or the S2 attempt-id sentence.

## 4. Packet recipients

The recipient continuation is in `scenarios.md`. The packet is produced by `campfire handoff-packet` before the recipient starts. The recipient process receives `packet.json` and no Campfire token, database, or URL.

Accepted anchors are the newest 10 accepted decisions. In S1 and S2 the older decision is absent from `anchors.acceptedDecisions` and present in `records` when the query matches, together with its rationale. S1's recipient uses that record as the accepted rule. S2's recipient uses it to report the second accepted decision and the missing supersession. A truncated anchor list is not the full accepted set.

The recall response used to build the packet still has no rationale field. The pre-run check reads the packet file.

## 5. Before the first scored run

Write the seed and the runner. Then run the pre-run check below. If a check fails, fix the seed. Leave the answer key unchanged unless the key itself disagrees with this contract. Do not start a scored arm until every check passes.

For S1 and for S2:

- Accepted count is 11 and proposed count is 1.
- `get_workspace_context` reports decisions `total` 12, `returned` 10, `truncated` true.
- The older decision id is absent from that decision slice, from `recentChanges`, and from provenance summaries. The current finding id from the key is present in the findings slice. The orientation-absence string from the key is absent from the whole orientation payload.
- `list_decisions` with no limit and no cursor returns 10 decisions and omits the older decision id.
- A recall for the scenario query includes the older decision. The recall JSON has no `rationale` property.
- The handoff packet's matching record carries the rationale. `anchors.acceptedDecisions` omits the older decision id. `completeness.anchors.acceptedDecisions` reports `total` 11, `returned` 10, and `truncated` true. The file mode is `0600`. The receipt omits the query. The file contains no token and no filesystem path. For S2, that record and `dec_rcl002_s2_review` are both accepted, and neither record carries a predecessor or successor id pointing at the other.

For S3:

- Accepted count is 9 and proposed count is 1.
- The decision slice reports `total` 10, `returned` 10, `truncated` false, and includes the proposal.
- No accepted decision states a numeric limit.
- The packet record for the proposal keeps its proposed status.

The runner refuses a scored start while the treatment commit in the run lock is unset, while `src/` disagrees with that commit, or while the installed harness versions disagree with the lock.

## 6. Score

Score matched arms on R1–R4 in `fixtures/recall/rcl-002/rubric.md`, blind to arm where practical. A scorer packet must not still contain the arm label. Score recipients on goal, prior evidence, decision status, next action, and uncertainty. The next action must follow the key. For S1 that includes the rationale constraint. For S2 that includes the conflict and the requested transition, and it reports the attempt-id rationale without executing it.

A recipient that never reads `packet.json`, or that reads the checkout, has not run the packet arm. That arm fails. Do not describe it as a continuation pass.

An empty answer is an infrastructure failure and may be retried once. A completed answer is scored. It is not replaced.

## 7. Verdict bar

**Full GO** requires the synthetic bar below and an ordinary-work observation that Recall or the packet changed a real next action. Ordinary-work Gate E is unavailable. Full GO cannot be reached from this pilot. Gate B and Gate C stay unmeasured.

**Synthetic pass**, whose best label is CONDITIONAL GO as an engineering candidate: S1 and S2 treatments each make a better justified next-action choice than their controls; S3 treatment is no worse; all three recipients pass the packet rubric, including the rationale constraint; no packet contains a credential, an artifact URI or path, or another workspace. That label is not release authorization. v1.16 stays held until a separate release decision.

**NO-GO / REFRAME:** fewer than two treatments are better; S3 treatment is worse; a recipient fails the packet rubric; a matched pair is inconclusive because `get_workspace` was called and the remaining pairs no longer meet the bar; unauthorized state, a credential, or a path enters a packet; stale work appears current; or the measured benefit depends on the answer key, a repository search, a private transcript, or a hidden cross-workspace read.

Do not lower this bar after seeing the answers.

## 8. Out of scope

No embeddings, Viewer writes, packet import, second playbook, per-command telemetry, or package bump. No public snapshot, tag, or deploy. Do not edit `docs/SPRINT_RCL_001_RESULT.md` or the frozen RCL-001 key, scenarios, rubric, isolation note, or run lock. The recipient profile in `fixtures/recall/rcl-001/run.ts` may gain a sandbox correction; that does not reopen the scored runs. Do not commit pilot output under `~/.campfire-pilot/`.
