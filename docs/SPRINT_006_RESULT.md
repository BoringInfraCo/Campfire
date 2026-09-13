# Campfire — Sprint 006 Result

**Status:** Complete  
**Sprint:** 006 — Multi-Participant Value (Gate C)  
**Date:** September 12, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 005 — Team Identity + Hosted Instance (**GO**)  
**Recommendation:** **GO** (product surface). Week-long dogfood is **not** claimed.

---

## 1. Result

Sprint 006 asked:

> **A third distinct human can contribute durable state on the hosted instance,
> and a different harness can continue from that state — without a transcript,
> Slack paste, or SQLite copy.**

Yes, on HTTP. Sergio created a workspace and invited Alice, Codex, OpenCode, and
Marcus (Marcus was `create_human`, not seed). Codex recorded a finding, accepted
decision, task, and artifact. Marcus added a finding: do not change the public
API. OpenCode retrieved `get_workspace_context`, saw Marcus's finding, completed
the task, and wrote a continuation finding that cited the public API constraint.

Eve (created, not invited) was denied. OpenCode could not read the unrelated
workspace. A private transcript sentinel never entered Campfire.

Sprint 001 local acceptance remains **GO**.

No Viewer. No Constraint type.

---

## 2. What landed

| Surface | Behavior |
|---|---|
| Gate C test | `tests/acceptance/gate-c.test.ts` on `campfire serve` |
| Task assignee | `update_task` can set/clear assignee |
| CLI | `create-task`, `add-finding`, `add-decision`, `add-artifact`, `join` |
| Runbook | `docs/OPERATOR.md` |
| Version | **1.0.0** (product Gate C; dogfood not claimed) |

---

## 3. Tests

```bash
npm run typecheck
npm test                 # 17 files, 160+ tests
npm run acceptance       # Sprint 001 GO
```

Gate C metrics (deterministic hosted run): ≥3 humans, ≥2 agents, Human C finding used by Agent B, orientation call ≥ 1.

---

## 4. Limitations

1. The proof is a deterministic HTTP fixture, **not** a week of real team use.
2. Two harnesses (Codex + OpenCode identities). Claude Code live run not repeated.
3. Local stdio without `CAMPFIRE_URL` still accepts `CAMPFIRE_ACTOR_ID`.
4. Viewer is still future work.

---

## 5. Recommendation

```text
GO
```

Gate C holds on the hosted token/invite path: a third human's contribution is
what the second agent continued from.

Call this **1.0.0** for the product cut (shared workspace, tokens, invites, HTTP,
CLI inspector, Gate A–C proofs). Do not treat that as evidence of organizational
memory or daily team retention.

---

## 6. Next

- Real multi-day dogfood on `campfire serve` (label it; do not pretend this sprint was that).
- Viewer 001 against this HTTP/token architecture, if wanted.
- Constraint/Instruction only if dogfood shows Goal/Decision/Finding are not enough.
