# Campfire — Sprint 004: Living Workspace

**Status:** Complete (GO)  
**Sprint:** 004 — Living Workspace  
**Date:** September 12, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 003 — Agent Orientation  
**Gate:** B — Repeat usage

---

## 1. Sprint Thesis

Sprints 001–002 proved a single handoff. Sprint 003 made orientation compact.

Sprint 004 must prove:

> **The same workspace stays useful across multiple sessions, created and inspected without seed fixtures, without becoming a dump.**

Workspaces must be created through the product. Humans must be able to inspect and act from the CLI. Orientation must stay bounded as contributions grow.

This is not hosting, tokens, or invite-only membership (Sprint 005).

---

## 2. In Scope

1. **`create_workspace`** on MCP and CLI. Service already has `createWorkspace`. Creator becomes owner.
2. **Workspace lifecycle** on the surface: `active → completed | archived`, `completed → archived | active`. Reject invalid transitions (`assertWorkspaceTransition`).
3. **One current goal.** `create_goal` fails with `Conflict` if an active goal already exists. `update_goal` can change title/description/status. Projection uses the active goal (not first-by-`created_at`).
4. **`get_activity` pagination.** Return `{ items, total, truncated, nextBefore? }`. Optional `limit` and `before` (contribution id). Unspecified limit returns the full log. Orientation remains capped at 20.
5. **Human inspector CLI:**
   - `show` prints the orientation projection as readable text (`--json` for the blob, `--full` for `get_workspace`)
   - `activity --limit` / `--before`
   - `create-workspace`
   - `update-workspace --status`
   - `accept-decision`
   - `update-task`
   - `create-goal` / `update-goal`
6. **Seed provenance.** Fixture workspaces, participants, goals, and findings must write contribution rows. Identity tables (org/team/human/agent) may remain seed-only.
7. **Deterministic multi-session acceptance.** A workspace created via `create_workspace` is reused by a second isolated MCP client. Orientation size stays capped after many writes.

## 3. Out of Scope

HTTP hosting, actor tokens, invite graph, UI, Postgres, finding lifecycle, relationship primitives, GitHub, Claude Code validation.

Do not add a finding status enum. Observe only.

## 4. MCP tools to add or change

Short names (server is already `campfire`):

```text
create_workspace     teamId, name, description?
update_workspace     workspaceId, status
update_goal          goalId, title?, description?, status?
get_activity         workspaceId, limit?, before?   → ActivityPage
```

Existing `create_goal` gains the active-goal uniqueness rule.

## 5. Exit

- Deterministic tests for create/lifecycle/goal conflict/activity page/seed contributions/CLI inspector.
- Multi-session acceptance: workspace created through the product; second session continues; orientation truncated under load.
- Sprint 001 acceptance remains GO.
- `docs/SPRINT_004_RESULT.md` with GO / CONDITIONAL GO / NO-GO.

Real multi-day dogfood is labeled if not run. It does not block the product-surface GO; it is called out as remaining Gate B human evidence.
