# Campfire — Viewer 001: Visual Inspector

**Status:** Complete (GO)  
**Sprint:** VIEWER 001 — Visual Inspector  
**Date:** September 12, 2026  
**Depends on:** Sprint 006 — Multi-Participant Value (**GO**)

---

## 1. Thesis

> **A human can watch one local Campfire workspace as a sparse workstream of contributions, without a transcript and without a second database.**

The Viewer is a **projection**. It is not a chat, harness, or dashboard.

Later visual work may project orientation, catch-up, and drill-down. It remains a read-only projection of workspace state. Direction and the evidence gate are in `docs/ROADMAP.md`. This sprint's scope is unchanged.

---

## 2. In scope (only this)

1. `campfire view [--host 127.0.0.1] [--port 9415]`
2. Loopback process that:
   - serves a single HTML/CSS/JS page
   - proxies **read-only** calls using the same backend as the CLI (`CAMPFIRE_URL`+token or local SQLite)
   - **never** sends the token to the browser
3. UI:
   - workspace picker (`list_workspaces`)
   - participants, goal, open tasks, proposed+accepted decisions, findings, artifacts (`get_workspace_context`)
   - chronological workstream (`get_activity`, paged)
   - expand a contribution for payload / object id (fx two-density: compact row, expanded detail)
   - poll ~2s
4. fx grammar only: sparse scrollback, quiet chrome, monospace, keyboard (j/k or arrows, enter expand, 1–9 or list to switch workspace). No agent traces.

## 3. Out of scope (do not add)

Composer, Constraint/Instruction, writes (`accept-decision`, `update-task`, etc.), Electron/Tauri/.app, libfx, React/SPA framework, presence, chat, kanban, settings, GitHub, embeddings, live harness tool traces, second SQLite, copying state.

Allowed proxy methods **only**:

```text
whoami
list_workspaces
get_workspace
get_workspace_context
get_activity
```

Any other method → 403.

## 4. Architecture

```text
browser  →  127.0.0.1:9415 (viewer)
                │
                │ POST /api/call  (no bearer in the page)
                ▼
         campfire view process
                │
         same backend as CLI
          ┌─────┴─────┐
          ▼           ▼
    local service   CAMPFIRE_URL + token
```

## 5. Exit

- Deterministic test: start viewer against a seeded DB, `GET /` is HTML, `POST /api/call` `list_workspaces` returns billing workspace, `add_finding` is rejected.
- Agent writes a finding via service/HTTP; after poll/proxy `get_activity` includes it.
- Sprint 001 acceptance still GO.
- No new domain tables.

Default port **9415** so it does not collide with `campfire serve` (9414).
