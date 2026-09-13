# Campfire — Viewer 002: Team Journal

**Status:** Complete (GO)  
**Sprint:** VIEWER 002 — Visual language  
**Date:** September 13, 2026  
**Depends on:** Viewer 001 (**GO**)

---

## 1. Thesis

> The Viewer is an interactive team journal. The workstream is the page. Current state is a few lines, not a second product.

Same APIs. Still read-only. No new tables. No composer. No writes.

---

## 2. In scope (only this)

1. **No stuffed sidebar.** Remove `aside#context` inventory (goal/participants/proposed/accepted/tasks/findings/artifacts as a column of empty dashes).
2. **Masthead:** people as marks (`●` human, `◇` agent), one **GOAL** line, workspace control labeled `workspace`.
3. **Workstream is the story.** Each contribution:

   ```text
   Sergio                                         18:38
   └ finding
     Auth token rotation: old signing key retired…
   ```

   Not five columns (`create` / `finding` / ids). Newest at the bottom.
4. **Inspect earns Enter.** Extra fields only: finding `detail`, decision `rationale`, artifact `uriOrPath`, task `description`, `approvedBy`. If none, Enter is a no-op (no JSON, no objectId, no duplicate actor id, no ISO timestamp).
5. **Plumbing folded.** Consecutive `join` / `create workspace` / `invite` / `register_session` collapse to one muted line (`N membership events`). Click/Enter on that line expands the muted rows. Work events stay visible.
6. Keep poll, keyboard (j/k, Enter, [/], 1–9), read-only allowlist, token in the process.

## 3. Out of scope

Composer, writes, Constraint, chat, Kanban, related-to-task graph, presence, workspace search combobox, Electron, `.app`, new MCP methods, schema changes.

## 4. Exit

- Seeded workspace: first screen is people + goal + workstream, not a left inventory.
- Expand on a finding that only has `summary` adds no JSON blob.
- Joins are not the dominant first impression.
- Existing viewer tests still pass. Sprint 001 still GO.
