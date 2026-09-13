# Campfire — Viewer 001 Result

**Status:** Complete  
**Sprint:** VIEWER 001 — Visual Inspector  
**Date:** September 12, 2026  
**Recommendation:** **GO**

---

## 1. Result

`campfire view` is a read-only loopback inspector. The browser talks to
`127.0.0.1:9415`. The process uses the same backend as the CLI. The token never
enters the page. Writes (`add_finding`, etc.) return 403.

A finding written through `CampfireService` appears in Viewer `get_activity`.

Sprint 001 acceptance is unchanged (local MCP, no Viewer required).

---

## 2. What landed

| Piece | Behavior |
|---|---|
| `campfire view` | Default `127.0.0.1:9415` |
| `src/viewer/server.ts` | Static files + `POST /api/call` allowlist |
| UI | Workspace picker, context column, contribution workstream, expand row |
| Poll | 2s |

Allowlist: `whoami`, `list_workspaces`, `get_workspace`, `get_workspace_context`, `get_activity`.

---

## 3. Out of scope (kept out)

Composer, writes, Constraint, Electron, libfx, second database, harness traces.

---

## 4. Tests

`tests/integration/viewer.test.ts`: HTML, list workspaces, read-only reject, context goal, service-written finding visible via proxy.
