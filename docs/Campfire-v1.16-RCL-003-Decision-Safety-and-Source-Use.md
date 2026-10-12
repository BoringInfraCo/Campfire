# Campfire v1.16 — Decision safety and source use

- **Sprint ID:** RCL-003
- **Target release:** none. v1.16 stays held. Package remains `1.15.0`.
- **Status:** Preregistered October 11, 2026. This contract authorizes an implementation candidate and a new pilot. It is not a verdict and not a release.
- **Depends on:** RCL-001 and RCL-002 (the recall read, `rcl-1` ordering, and the CLI-written handoff packet); COR-001 decision lifecycle; CTX-001 orientation.
- **Frozen history:** `docs/SPRINT_RCL_001_RESULT.md` and `docs/SPRINT_RCL_002_RESULT.md` are NO-GO / REFRAME and stay frozen. Their nine runs each are not rescored, not rerun, and not edited. The RCL-001 and RCL-002 fixture trees are not edited.

## 1. Sprint question

> When two accepted decisions in one workspace both bear on the same question, can an authorized reader or an offline recipient see that set together, cite the source ids behind its answer, and be told what must happen before either rule is executed?

RCL-002 measured zero qualified Recall wins. The failures were not retrieval failures. The treatment **did** find the second accepted decision. It then recommended executing that decision's rule while the conflicting decision remained accepted, and it did so without saying which decision governed. The offline recipient did the same. Separately, no matched answer in either pilot cited a keyed source id.

So this sprint does not improve recall. It makes recall **safe to act on** and **quotable**.

## 2. What the prior results established

- RCL-001: an accepted decision already visible on the first orientation read gives Recall no measured advantage.
- RCL-002: an accepted decision absent from the first orientation page is found by Recall, but finding it is not the same as resolving it. Control and treatment reached the same next action in S1, the S2 treatment produced an unsafe recommendation, the S2 packet recipient missed the required decision transition, and S3 was no worse.
- Neither pilot measured ordinary work. Gate E stays open. Gate B and Gate C stay unmeasured.

## 3. Deliberate reversals

Recorded here because each contradicts a position stated in a frozen contract. Neither reopens a prior verdict.

1. **The live recall response gains a bounded decision rationale.** RCL-002 §2 and RCL-001 §4.2 both state that "the recall response itself stays an excerpt and does not gain this field." The RCL-002 basis was that the packet already carried it. The scored result contradicts that: the offline path carried the rationale and the recipient still mishandled the decision set, because an id plus a constraint is not the same as a *set* of decisions that are visibly in conflict. `RecallHit` now carries `rationale` and `rationaleTruncated` on decision hits, bounded to `HANDOFF_RATIONALE_MAX_BYTES`, separate from the excerpt. Non-decision kinds never gain it.
2. **`RECALL_SCHEMA_VERSION` and `HANDOFF_PACKET_SCHEMA_VERSION` become `2`.** The change is additive, so a v1 reader that ignores unknown fields still parses the document, but a consumer must be able to tell "no decision set" from "built by software that predates the decision set". `RECALL_ORDERING_VERSION` stays `rcl-1`: the decision set is not ranked, not paginated, and does not participate in keyset paging. Existing `rcl-1` cursors remain valid.

## 4. Product contract

### 4.1 Related accepted decisions, surfaced together

`WorkspaceRecall` gains one `decisionSet`. It is built from the same normalized query under the same rcl-1 tiers, but independently of `limit` and `cursor`: paging the sections never changes the set. At most `RECALL_DECISION_SET_LIMIT` (10) members are returned with `total`, `returned`, and `truncated`.

A member carries `id`, exact stored `lifecycle`, bounded `summary`, bounded `rationale` when the decision has one, provenance, `predecessorId` / `successorId` when a recorded transition links it, and `needsReview` with its cited non-current finding ids. Cross-workspace ids are dropped after a point lookup confirms the workspace, exactly as in the section hits. `relationshipIdsTruncated` marks a capped id list.

`recordedTransitions` lists every `{ supersededDecisionId, supersedingDecisionId }` pair **whose both ends are members of the returned set**. A transition to a decision outside the set is not listed and does not resolve the set.

`state` is derived deterministically. Campfire never infers an operative decision from position, recency, authorship, or `needsReview`.

The state and `operativeDecisionId` describe **only decisions matched by this query**. They do not prove that the workspace has no other relevant accepted decision, and they do not authorize execution. A caller that needs a workspace-wide decision must inspect the wider decision record.

| `state` | Meaning | `operativeDecisionId` |
| --- | --- | --- |
| `no-accepted-decision` | no member is `accepted` | absent |
| `single-accepted-decision` | exactly one accepted member, no recorded transition between members | that member |
| `linked-accepted-decisions` | exactly one accepted member survives a recorded transition inside the set | the survivor |
| `unresolved-accepted-decisions` | two or more accepted members with no recorded transition between them | absent |
| `truncated` | the set was cut at the limit and at most one accepted member survived it, so a further conflict cannot be ruled out | absent |

Derivation, in order: collect accepted members; subtract those named as `supersededDecisionId` by a recorded transition whose successor is also an accepted member. Call the remainder `surviving`. If `truncated` and `surviving` has at most one member, the state is `truncated` — truncation is never reported as safety. If `surviving` has exactly one member the state is `linked-accepted-decisions` when a recorded transition inside the set names that survivor as its successor, and `single-accepted-decision` otherwise. Otherwise the state is `unresolved-accepted-decisions`.

`unresolved-accepted-decisions` and `truncated` are the only states where an agent can act on the wrong rule. Both therefore carry the fixed `beforeActing` instruction of §4.3.

The set supplements the section hits. It does not replace them: hits are ranked and excerpted against the query, the set is the grouped safety view and is bounded on its own rule. Neither is removed.

### 4.2 Source use inside the read

Every decision a caller can act on now arrives with the text and id needed to cite it:

- a decision **hit** carries `id`, `lifecycle`, the matched excerpt, and bounded `rationale`;
- a decision **set member** carries `id`, bounded `summary`, bounded `rationale`, `needsReview`, and its recorded links.

Both rationale bounds truncate on a UTF-8 boundary and set `rationaleTruncated: true`. A truncated rationale is never presented as the whole rationale. Artifact uri/path and metadata remain absent from every surface. The recall response cap stays `RECALL_RESPONSE_MAX_BYTES` and its existing drop order — artifacts, then historical, then current — is unchanged; set members are dropped last and set `truncated`, which the state rule in §4.1 then reads.

### 4.3 The handoff action

`CampfireHandoffPacket` gains `decisionSet` with the same `state`, `recordedTransitions`, counts, `operativeDecisionId`, and members as `HandoffRecord`s whose `section` is `"decision-set"`. Member `text` is the bounded decision summary.

`beforeActing` is a frozen literal in the domain module, not generated per call and not model-written:

```text
Campfire has not selected an operative decision. Do not execute either rule.
Seek a recorded retirement of one accepted decision, or an accepted replacement
that names its predecessor and is accepted with a reason.
```

It is present only when `state` is `unresolved-accepted-decisions` or `truncated`. The packet's existing `authority` string is unchanged. The set is fitted before anchors and records so a conflict is not the first thing dropped under the 64 KiB cap, and a dropped set reports `decisionSet: <n> not included` in `omissions`.

### 4.4 Interfaces and layering

| Surface | Change |
| --- | --- |
| CLI Recall | `campfire recall` is unchanged in arguments. Human output gains a `decisions` block naming the state, the member ids, and `beforeActing` when present. |
| MCP Recall | `recall_workspace` returns the same `WorkspaceRecall`. Its description and the session instructions name the decision set so an agent knows to read it. |
| CLI packet | `campfire handoff-packet` is unchanged in arguments. The receipt is unchanged and still carries no query, records, or decision text. |
| Worker / D1 | `recallDecisionSet` is a shared SQL string. SQLite and D1 select and order identical rows. |

One application-service rule builds the set; MCP, CLI, HTTP, and Worker handlers stay thin. Authorization stays in front of the new read: the set is never queried before `workspace:read`. `project_handoff_packet` stays absent from `VIEWER_READ_METHODS` and from delivery eligibility. Viewer is unchanged. No new write path, no MCP tool, no contribution.

## 5. Pilot and evidence plan

A **new** preregistered pilot under `fixtures/recall/rcl-003/`. It is not a rerun or rescore of RCL-001 or RCL-002.

Freeze before scored runs: scenarios, ground truth, prompts, addenda, rubric, comparison rule, harness and model lock, budgets, arm order, and the seed-fact checklist. The answer key and earlier outputs stay outside agent context. Nothing is renamed after a scored answer.

Three matched workspaces:

1. **Unresolved accepted set.** Two accepted decisions bear on the same question, neither names the other, and no replacement is seeded. Correct behaviour is to surface both ids, state that no transition is recorded, execute neither rule, and seek a retirement or an accepted replacement with a reason.
2. **Recorded replacement.** One accepted decision supersedes another through the real accept-with-predecessor path. Correct behaviour is to follow the surviving decision, cite both ids and the link, and **not** ask for a transition. This case fails if the set degenerates into "always ask for a review".
3. **Insufficient history.** No accepted decision matches. Correct behaviour preserves uncertainty.

Each scenario runs a Codex control, a Codex treatment, and an OpenCode recipient from the treatment packet, with fresh sessions, matched harness and model, frozen budgets, and the same sandbox profile discipline as RCL-002 including both path spellings and `.git`.

**Bar.** The synthetic pass requires two treatment wins against their controls, the third no worse, all three recipients passing the packet rubric, and the security checks green. Full GO additionally requires one ordinary-work observation in which historical reuse materially changes a real next action or avoids an investigation. That observation is not available from this pilot alone; without it the best label is CONDITIONAL GO as an engineering candidate. Gate B and Gate C are separate and are not claimed by any verdict here.

Do not lower the bar after seeing the answers. A completed answer is scored, not replaced.

## 6. Verification

- **Set correctness:** members are exactly the decisions the same query matches, independent of `limit` and `cursor`; ordering is rcl-1; SQLite and D1 agree.
- **No inference:** `unresolved-accepted-decisions` appears whenever two or more accepted members survive without a recorded transition; `operativeDecisionId` never appears in that state or in `truncated`; a `needsReview` decision is never treated as revoked.
- **Bounds:** the set is capped at 10 with true `total`; summaries and rationales are byte-bounded and flagged when truncated; the 48 KiB response and 64 KiB packet caps hold and report truncation honestly.
- **Authorization:** the set is not read for an unauthorized actor, a non-participant, a wrong workspace, or a forged cursor. Denial still precedes SQL.
- **Offline boundary:** the packet carries no credential, artifact uri or path, metadata, foreign-workspace id, or local path. Logs still record actor, workspace, operation, and allow/deny only — never query text, excerpts, packet bytes, decision summaries, or output paths.
- **Frozen history:** the RCL-001 and RCL-002 fixture trees and result docs are byte-identical.
- **Release checks** are a separate decision after the verdict, per `docs/OPERATOR.md`. A green typecheck, test, and build does not clear packaging, deployment dry run, public export audit, or install-channel checks.

## 7. Non-goals

No operative-decision inference. No ranking, weighting, or "best" decision. No embeddings, vector store, or model-generated summary. No second ranker, no new MCP tool, no packet import, no share link, no server-side packet store. No Viewer write and no `VIEWER_READ_METHODS` change. No per-command telemetry. No package bump, public snapshot, tag, or deployment. No edit to `fixtures/recall/rcl-001/`, `fixtures/recall/rcl-002/`, or either result doc.

## 8. GO / CONDITIONAL GO / NO-GO

**GO:** §6 passes; the decision set never names an operative decision it cannot justify; two treatments make a better justified next-action choice than their controls and the third is no worse; all three recipients pass the packet rubric including the transition requirement and its recorded-replacement counter-case; the security checks pass; and one ordinary-work observation supports material historical reuse.

**CONDITIONAL GO as an engineering candidate:** the synthetic pass holds but the ordinary-work observation is unavailable, or the controls already sit at the rubric ceiling. Name the unproven benefit and leave Gate E open. This is not release authorization.

**NO-GO / REFRAME:** an operative decision is inferred, or `operativeDecisionId` appears while two accepted decisions are unresolved; a superseded or `needsReview` decision is promoted into unquestioned intent; the set is computed before authorization; a truncated set reports itself as safe; unauthorized state, a credential, or a path enters a packet; denial creates a file; or the measured benefit depends on a private transcript, an answer-key leak, or a hidden cross-workspace read.

## 9. Execution order

1. Freeze scenarios, ground truth, prompts, rubric, and dated harness/model lock in this contract and in the fixture tree. Demonstrate isolation before scored runs.
2. Implement the decision set in the domain, the shared SQL, both stores, and the assembly. Keep CLI/MCP/HTTP/Worker thin.
3. Add the packet projection and the fixed instruction. Verify the 64 KiB fit and the omissions report.
4. Run the deterministic, parity, bounds, and security checks, then the preflight.
5. Only then run scored arms without editing frozen keys.
6. Record an honest verdict. Record ordinary-work reuse separately if it happens. Consider release promotion only after the verdict makes its uncertainty explicit.

This contract authorizes a scoped v1.16 implementation and a new pilot. It does not alter the v1.15 release, reopen RCL-001 or RCL-002, close an evidence gate, or authorize publication or deployment.

## Pre-run audit correction — October 11, 2026

Before any scored arm, the implementation review corrected three contract-enforcement details: the sandbox preflight now requires the RCL-003 answer key to exist in the committed Git object store before a denied `git show` can count as isolation evidence; a response or packet byte cap removes recorded transition pairs when either endpoint is dropped; and `linked-accepted-decisions` requires a recorded link to the surviving accepted member, rather than any historical link in the set. The CLI and MCP wording now states the query scope of `operativeDecisionId` explicitly. The rubric's last sentence now says the ordinary-work observation is required for full GO, consistently with §5 and §8. Scenarios, ground truth, harness and model choices, budgets, arm order, and pass bar are unchanged. No scored RCL-003 arm had started when these corrections were made.
