# Campfire — Sprint 008 Result

**Status:** Complete  
**Sprint:** 008 — Enter the Room  
**Date:** September 24, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 007 — Harness Readiness Preflight (**GO**)  
**Recommendation:** **CONDITIONAL GO**

---

## 1. Result

Sprint 008 asked:

> Can a human or agent enter an active Campfire workspace with no prior
> transcript and correctly understand the state of the work within 30 seconds?

Yes for comprehension: a cold Codex process with no transcript or handoff read
Campfire state and correctly answered all seven entry questions, including the
goal, participants, findings, constraining decisions, blocked work, and next
action.

The 30-second Time to Context target is not yet demonstrated. The measured
31.7 s is a whole-process upper bound (CLI startup, MCP handshake, model
latency, five reads, and the statement), not first-read-to-statement time. The
result is therefore CONDITIONAL on instrumenting the precise interval.

No schema, authorization policy, orchestration, or writable Viewer behavior was
added.

---

## 2. What landed

| Surface | Behavior |
| --- | --- |
| Application service | One service-derived orientation projection: authorization-aware `needsYou`, team `needsAttention`, `currentWork`, `suggestedNextAction`, `provenanceSummary`, optional `since` cursor |
| CLI | Human orientation renders Needs You, Needs Attention, Current Work, and the next-action hint |
| MCP / HTTP | `get_workspace_context` accepts an optional `since` cursor and returns the same projection |
| Workers/D1 | Async service and dispatch parity with the sync service |
| Viewer 003 | Read-only "Enter the Room" panels: Needs You, Needs Attention, Current Work, Since You Were Here; task and decision state labels are distinct |
| Authorization | `canAct` reuses the existing authorizer; no policy change; "Needs You" only contains items the actor may act on |
| Next action | Deterministic precedence with oldest-`updatedAt` then id tie-break; explicitly an orientation hint, never executed |

---

## 3. Validation matrix

```text
npm run typecheck          PASS
npm test                   PASS — 25 files, 278 tests
npm run test:acceptance    PASS — 3 files, 8 tests
npm run acceptance         GO — 19/19 checks
npm run build              PASS
git diff --check           PASS
```

Deterministic coverage includes one-call orientation, authorization-aware
Needs You vs Needs Attention, deterministic next-action precedence and
tie-break, provenance summary, `since` projection including unknown-cursor
rejection, sync/async/HTTP/MCP parity, Viewer derivation from a synthetic
context, read-only Viewer rejection of writes, unchanged read allowlist, and
authorization-aware edge cases (viewer-assigned tasks and the generic
oldest-open-task fallback).

---

## 4. Cold real-harness evaluation

- Harness: real `codex-cli 0.150.1`, ephemeral, no transcript or handoff.
- Exit: 0. Campfire MCP calls: 5. Non-Campfire tools: 0.
- Measured duration: 31,679 ms (whole-process upper bound).
- Comprehension: PASS for all seven questions; correctly named the goal, a
  blocked task, a proposed decision, and the deterministic next action.
- Evidence: `evidence/sprint-008/cold-harness.md` (private, gitignored).

---

## 5. Architecture and scope

- No schema or migration changed.
- No domain object or lifecycle was added.
- No authorization policy changed; `canAct` reuses the existing evaluator.
- No automatic execution of `suggestedNextAction`.
- No Viewer writes; the Viewer remains read-only with the existing allowlist.
- No orchestration, scheduling, presence, notifications, chat, or execution
  ownership.
- No Sprint 009 work.

---

## 6. Limitations

1. Time to Context is a process upper bound, not first-read-to-statement; the
   30-second target is not proven.
2. Human comprehension was validated structurally (deterministic derivation and
   review), not behaviorally timed.
3. The cold run used one harness, one model, and one populated workspace; the
   entrant was the same agent identity that authored the state, so this proves
   cold read/restate, not cross-agent continuation.
4. "Since You Were Here" uses a client-side cursor; durable server-side read
   state would require schema and remains out of scope.

---

## 7. Recommendation

```text
CONDITIONAL GO
```

The projection answers the entry questions and the surfaces share one derived
understanding. Before claiming the 30-second target, instrument the precise
first-read-to-statement interval and rerun the cold harness. Do not begin
Sprint 009 from this result without that decision.
