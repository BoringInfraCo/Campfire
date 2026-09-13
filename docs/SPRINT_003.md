# Campfire — Sprint 003: Agent Orientation

**Status:** In tree (deterministic exit met; real-harness orientation rerun and Claude Code still outstanding)  
**Sprint:** 003 — Agent Orientation  
**Date:** September 12, 2026  
**Company:** Boring Infra Co.  
**Depends on:** Sprint 002 — Real Team Handoff (**GO**)

---

## 1. Sprint Thesis

Sprint 002 proved a real incoming agent can continue work from Campfire state.

It also showed that the incoming agent orients poorly:

- it fetched two overlapping full projections (`get_workspace` and `get_workspace_context`);
- `get_workspace_context` was ~27 KB for a tiny workspace because it returned the entire contribution log;
- proposed decisions are invisible in the continuation projection;
- OpenCode exposed tools as `campfire_campfire_*`;
- artifact URIs were harness-absolute paths.

Sprint 003 must prove:

> **An incoming real agent orients from one compact projection and does not miss proposed decisions, drown in provenance, or fight tool names / artifact paths.**

This is a daily-use surface change. It is not hosting, identity productization, or a new domain object.

---

## 2. In Scope

1. Single orientation entry point. `get_workspace` remains the full inspector. `get_workspace_context` becomes the compact agent projection:

   ```text
   workspace
   goal
   participants
   proposed decisions
   accepted decisions
   superseded decision summaries
   open tasks
   findings
   artifacts
   recent provenance (capped)
   ```

2. Provenance/activity cap in the orientation payload.
3. Decision visibility: surface `proposed` (and superseded as short summaries).
4. Drop the `campfire.` tool prefix so a server named `campfire` exposes `list_workspaces`, not `campfire_campfire_list_workspaces`.
5. Normalize artifact URIs to workspace/repo-relative or stable `https:` URIs. Reject silent absolute home paths. Do not store file contents.
6. Versioned SQLite migrations (implement `schema_migrations` for real).
7. Claude Code validation of the same Codex → Harness B flow. If OAuth is blocked, record CONDITIONAL on harness coverage and do not stall Sprint 004.
8. Align stale docs: AGENTS.md, ROADMAP, README, sprint status lines.

## 3. Out of Scope

Hosting, actor tokens, `create_workspace` productization, finding lifecycle, relationship graph, UI, Postgres, GitHub, invite-only membership.

## 4. Exit

- Deterministic tests: one-call orientation, proposed decisions present, provenance cap, relative URIs, no double prefix.
- Sprint 001 + 002 regression green.
- Claude Code run recorded honestly (GO, or CONDITIONAL if OAuth blocks).
