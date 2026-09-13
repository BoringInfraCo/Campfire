# Campfire — Sprint 006: Multi-Participant Value (Gate C)

**Status:** Complete (GO)  
**Sprint:** 006 — Multi-Participant Value  
**Date:** September 12, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 005 — Team Identity + Hosted Instance (**GO**)  
**Gate:** C — Does Campfire become more useful when multiple humans and agents contribute?

---

## 1. Sprint Thesis

Sprint 005 made two processes share one writer with tokens and invites.

Sprint 006 must prove:

> **A third distinct human can contribute durable state on the hosted instance, and a different harness can continue from that state — without a transcript, Slack paste, or SQLite copy.**

This is Gate C as a **product proof**, not a week of real-team dogfood. Dogfood is labeled if not run. Viewer is out of scope.

---

## 2. In Scope

1. **Hosted Gate C acceptance** against `campfire serve` / `POST /v1/call`:
   - ≥3 humans (Sergio, Alice, a third created via `create_human` — not a seed-only identity)
   - ≥2 agents (Codex for Sergio, OpenCode for Alice)
   - one workspace created through the product
   - invites, not self-join
   - Agent A records goal/finding/decision/task/artifact
   - Human C contributes a finding or accepted decision **without using Agent A's session**
   - Agent B retrieves context, continues the outstanding task, writes new state
   - unrelated workspace isolation
   - no transcript sentinel in B's retrieval
   - metrics: distinct humans, distinct agents, contribution counts by actor, orientation vs full-inspector calls
2. **Human participation without a harness.** CLI already has `accept-decision` and `update-task`. Add `create-task`, `add-finding`, `add-decision`, `add-artifact` so a human can contribute the same objects agents do.
3. **Task assignee** on `update_task` if missing (reassignment is the smallest 004 leftover that Gate C actually uses: Human C or Agent A assigns the open task to Agent B).
4. **Operator runbook** (`docs/OPERATOR.md`): `serve`, tokens, invite, MCP `CAMPFIRE_URL` + `CAMPFIRE_TOKEN` for two harnesses.
5. Version: **1.0.0** only if the hosted proof GO's. Record that week-long dogfood is not claimed.

## 3. Out of Scope

Viewer, Constraint/Instruction type, Slack, Linear, GitHub, dashboard, presence, mentions, approval queues, SSO, Postgres, Claude Code live run (record as limitation unless already possible).

Do not add embeddings, orchestration, or transcript ingestion.

## 4. Exit

- Deterministic hosted Gate C test green.
- Sprint 001 acceptance still GO (local file mode).
- HTTP token isolation still holds.
- `docs/SPRINT_006_RESULT.md` with GO / CONDITIONAL GO / NO-GO and an honest dogfood line.

**GO** if the third participant's contribution is what Agent B used to continue.  
**CONDITIONAL GO** if the proof works but only on fixtures.  
**NO-GO** if Agent B only succeeds because the test copied answers outside Campfire.
