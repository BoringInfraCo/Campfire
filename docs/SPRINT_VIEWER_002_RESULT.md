# Campfire — Viewer 002 Result

**Status:** Complete  
**Sprint:** VIEWER 002 — Team Journal  
**Date:** September 13, 2026  
**Recommendation:** **GO**

---

## 1. Result

The Viewer is a journal, not an inventory. The workstream is the page. People and
one goal sit in the masthead. Empty sidebar buckets are gone. Joins fold into
`membership  N events`. Inspect shows extra object fields only; a summary-only
finding does not dump JSON.

Still read-only. Same APIs. No composer. No Constraint. No second store.

---

## 2. What landed

| Change | Behavior |
|---|---|
| Layout | Header + mast (people, GOAL) + workstream + hint |
| Workspace | Labeled `workspace` |
| Rows | `Name  HH:MM` then `└ kind` + sentence |
| Plumbing | Consecutive joins/creates/invites/sessions → one fold line |
| Inspect | detail / rationale / URI / description / accepted by / assigned |

---

## 3. Out of scope (kept out)

Writes, composer, Constraint, chat, Kanban, Electron, workspace search.

---

## 4. Tests

Existing viewer integration tests plus full suite / Sprint 001.
