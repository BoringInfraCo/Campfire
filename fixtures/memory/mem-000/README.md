# MEM-000 fixture — v1.29.7 memory-health baseline

> **NOTE (publication decision).** Every file in this directory is synthetic and
> is published in the public release by decision. These files are NOT a sealed or
> reusable blind evaluation set: `answer-key.json`, `questions.json`, and the
> candidate keys are public, so any model or person can read the answers.
> Treat them as deterministic regression fixtures only, not as held-out evidence.


**FIXTURE EVIDENCE — scripted engineering evaluation only.** This is not human
observation, a live harness result, Gate E, or a MEM-001 result. No
`get_memory_health` product method is implemented here.

`answer-key.json` `expectedCues` are the MEM-001 §3 objects copied from `candidate-projection-key.json`. `v1297ObservedScoringCues` freezes the four v1.29.7 observed scoring shapes. Safe resolution paths, including `remove_decision_basis` and `remove_finding_evidence`, are expectations and are not executed. The file also freezes clean controls, source facts,
coverage, denial shapes, next-safe-action rules, and contribution positions.
`questions.json` freezes the questions a later evaluator must answer from the
current read outputs rather than from this key.

The generator is `scripts/run-mem-000-baseline.ts`. It uses the real v1.29.7
application service and migrations with a queued id source and a fixed +1 second
write clock. Reads use a separate frozen clock. Two fresh databases must produce
byte-identical fixture, authorization, and current-read JSON. Raw actor tokens
are random implementation details; they are never emitted. Migration
`applied_at` values are not exported.

## Frozen workspaces

| Workspace | Purpose | Frozen state |
| --- | --- | --- |
| `ws_mem000_health` | Positive and negative source cases | 23 Tasks; 13 Decisions in list reads / 12 in orientation; 5 Findings; 2 ActionProposals; contribution tip 115 |
| `ws_mem000_clean` | Complete clean control | One supported current Finding, one accepted Decision citing it, one blocked Task with description and assignee, no ActionProposal; contribution tip 16 |
| `ws_mem000_other` | Denied discovery and cross-workspace leakage control | Owned only by `hum_mem000_wrong`; one synthetic sentinel Finding; contribution tip 3 |

The health workspace deliberately truncates orientation and first list pages.
The recipe follows decision and task cursors, reads current and all findings,
and uses action-proposal, action-receipt, get-by-id, and Recall APIs. A proposal
can appear in recent contribution projections, but there is no ActionProposal
orientation slice and Recall does not search ActionProposal records.

## Positive cases

- `dec_mem000_review`: accepted, `needsReview = true`, citing superseded
  `find_mem000_basis_superseded` through `cit_mem000_review_basis`.
- `find_mem000_contradicted`: current, with explicit
  `fev_mem000_contradicted_contradicts` to `art_mem000_counterexample`.
- `task_mem000_blocked_missing`: blocked with neither description nor assignee.
- `actp_mem000_unknown`: attached to `task_mem000_blocked_complete`, reserved as
  `resv_mem000_unknown`, with latest unknown receipt `arcp_mem000_unknown`.
  Existing authorized action reads can project this safely. The runner performs
  no provider call and the future cue allowlist must omit `providerRef`.

## Clean controls

- Current and replacement Decisions cite current Findings.
- `find_mem000_supported` has support only; `find_mem000_withdrawn` is not
  current.
- Blocked Tasks have both fields, description only, or assignee only. Only the
  missing-both Task is positive.
- `actp_mem000_accepted` and its accepted receipt are not unknown outcomes.
- The clean workspace is complete and produces none of the four conditions.

## Actors

The fixture includes a human owner/member/Viewer role, nonparticipant,
wrong-workspace owner, registered agent, unregistered agent, ended AgentSession,
and revoked credential. v1.29.7 has no active/revoked flag on
`workspace_participants`: credential revocation and ended-session denial are the
supported probes. Reads never register a session. Session ids in the fixture are
synthetic canonical provenance, not runtime/session operational captures.

All names and text are synthetic. Artifact references use the reserved
`example.invalid` domain and are never fetched. No real path, actor token or
token hash, provider payload, transcript, prompt, terminal content, PID, or user
profile is read or emitted. Action intent digests are deterministic synthetic
record fields, not credentials.

## Regenerate and verify

```sh
# Fresh safe temp output; exits nonzero on any key, auth, or replay mismatch.
npx tsx scripts/run-mem-000-baseline.ts

# Explicit sanitized evidence generation. The database stays in a fresh temp dir.
npx tsx scripts/run-mem-000-baseline.ts \
  --out docs/evidence/mem-001/step-0 --force

npm run typecheck
```

The runner requires Node 22 and verifies package `1.29.7`, annotated tag object
`2272dc7bbbe848629ed3ff7bd4851d527fe4d8e1`, peeled source target
`3e8abd0cdb5cb04ff93ca42b9f07b4eb1082eb7e`, and channel/HEAD
`60ab4e1236698023ed0eae063ddd1c8eeb9482d5`. It also verifies that product
source and migrations match the tag using read-only Git commands. It does not
inspect or change user profiles, external services, or Git state.

### Supplemental pagination fixture

`candidate-source.json` is the sanitized result of the separate isolated
`scripts/seed-mem-000-candidate.ts` service-written fixture. It has eight
candidate cues, tied source times, same-Finding relation ties, removal controls,
a whitespace-only positive, and a workspace with no work records. Its matching
`candidate-projection-key.json` states candidate §3 expectations, not v1.29.7
endpoint output. Run `python3 scripts/verify-mem-000-candidate.py` to check
source facts, §3.1 timestamps, and key ordering. Every subject `createdAt` in
this seed equals `clock` (`2026-11-07T12:00:00.000Z`). Action
`sourceUpdateTime` is `max(proposal.updatedAt, receipt.recordedAt)`; both stored
values are that clock, so the action cue stays there. `task_mempage_b.updatedAt`
is `2026-11-07T12:01:00.000Z` and is that task cue's `sourceUpdateTime`. The
verifier does not invent timestamps the seed omitted. The seed script accepts
optional output, new database, and private identity-file paths; its identity
file contains credentials and must stay in a private temporary directory, never
in the evidence bundle. The supplemental fixture is not a substitute for
actor-path baseline runs or a product memory-health read.
