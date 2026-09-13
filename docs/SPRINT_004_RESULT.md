# Campfire — Sprint 004 Result

**Status:** Complete  
**Sprint:** 004 — Living Workspace  
**Date:** September 12, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 003 — Agent Orientation  
**Recommendation:** **GO**

---

## 1. Result

Sprint 004 asked:

> **Can the same workspace stay useful across multiple sessions, created and
> inspected without seed fixtures, without becoming a dump?**

Yes, for the product surface. A workspace created through `create_workspace`
(not `seedFixture`) was reused by a second isolated MCP client. The incoming
agent recovered the goal, finding, accepted decision, task, artifact, and
provenance; orientation stayed capped at 20 contributions after 25 further
writes; activity pages with `limit`/`before` did not overlap; workspace
lifecycle rejected `archived → active`.

Humans can inspect that state from the CLI as readable orientation text, not a
JSON firehose.

Sprint 001 acceptance remains **GO** (19/19).

---

## 2. What landed

| Surface | Behavior |
|---|---|
| MCP `create_workspace` | Creator becomes owner |
| MCP `update_workspace` | `active → completed \| archived`; `completed → archived \| active`; `archived` is terminal |
| MCP `update_goal` | title / description / status |
| `create_goal` | `Conflict` if an active goal already exists |
| `getGoalForWorkspace` | prefers the active goal |
| `get_activity` | `{ items, total, truncated, nextBefore? }` with optional `limit` and `before` |
| Seed | workspace, join, goal, and finding rows have stable contribution ids |
| CLI | `show` orientation text; `activity --limit/--before`; create/update workspace, goal, task, accept-decision |

---

## 3. Tests

```bash
npm run typecheck     # clean
npm test              # 14 files, 126 tests, all passing
npm run acceptance    # Sprint 001: GO, 19/19
```

New: `tests/acceptance/living-workspace.test.ts`, `tests/unit/cli.test.ts`.

---

## 4. Limitations

1. Multi-session proof is deterministic in-process MCP clients, not a week of
   real team dogfood. Gate B *human* reuse is not claimed.
2. `join_workspace` is still same-team self-join. Invite-only membership is
   Sprint 005.
3. Finding lifecycle was not added. The living-workspace trace did not require it.
4. Artifacts remain references. CLI does not host a UI.

---

## 5. Recommendation

```text
GO
```

The living-workspace product surface works: create without seed, continue from a
second session, keep orientation bounded, inspect from the CLI.

Do not start Sprint 005 hosting/tokens until this trace is accepted as the
basis. Remaining Gate B evidence is real multi-day reuse, which Sprint 006
should measure rather than blocking 005’s operational identity work.

---

## 6. Sprint 005 focus (from this trace)

1. Actor tokens — `CAMPFIRE_ACTOR_ID` is still env-spoofable.
2. Invite-only membership — replace same-team self-join.
3. Team-hosted HTTP in front of `CampfireService`.
4. Bind session `humanId` from the agent row, not tool arguments.
