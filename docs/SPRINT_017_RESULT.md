# Campfire — Sprint 017 Result: Quiet Install & First Workspace

**Status:** Complete
**Decision:** GO
**Date:** September 25, 2026
**Release authorization:** `v1.5.0` minor release

---

## 1. Outcome

Sprint 017 is **GO**.

The first-run path now follows the intended product grammar:

```text
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
campfire
```

The installer points at `campfire` without printing environment-variable or
MCP-JSON homework. A terminal first run records only the human and stores the
operator credential locally. `campfire up` starts the local API and read-only
Viewer in one process, creates an owned agent for each installed validated
harness, writes its token only to that harness MCP block, and tells the human
to reload. It does not import past sessions or silently register an agent
session.

The collaboration model, authorization rules, persistence schema, MCP domain
surface, and Viewer write boundary are unchanged.

---

## 2. Implemented

- Quiet branded installer output whose next step is `campfire`.
- Local operator profile and mode-0600 credential store.
- XDG data/config defaults with an existing `$CWD/.campfire/campfire.db`
  compatibility path.
- Human-only default `campfire` first run and credential-free status output.
- `campfire up` for one-process HTTP API + Viewer startup, optional browser
  opening, and validated Codex/OpenCode connection.
- Installed-harness discovery and owned agent creation without transcript
  import.
- Grouped command help and copy-pasteable recovery guidance.
- Viewer empty-state language for the period before an agent starts work.

No daemon, hosted control plane, schema migration, transcript import, silent
session registration, Cursor adapter, or Claude Code adapter was added.

---

## 3. Automated verification

Node `22.23.2`:

```text
npm run typecheck   PASS
npm test            PASS — 36 files / 372 tests
npm run build       PASS
```

The first full-suite run exposed one macOS-only test portability defect:
`process.cwd()` canonicalizes `/var` to `/private/var`. The legacy database
compatibility behavior was correct; the assertion now compares against the
canonical current working directory. No production behavior changed.

---

## 4. Independent cold verification

The verification used fresh isolated config, data, credential, database, and
harness-config paths. It did not reuse the repository database or an existing
Campfire profile.

1. `campfire --human-name "Independent Verifier"` created one human only.
2. Human output showed `Waiting for an agent to start work`, stated that past
   sessions were not imported, and printed no credential.
3. A fresh workspace, `v1.5 independent verification`, and goal,
   `Prove v1.5 reaches a real token-free Viewer`, were created through the real
   application service boundary.
4. `campfire up` detected the installed Codex harness and wrote its MCP block
   to a temporary config with mode `0600`. It reported `Agents Codex`, started
   the API on `127.0.0.1:19714`, and started the Viewer on
   `127.0.0.1:19715`.
5. The full real Viewer was opened and captured in the in-app browser. It
   rendered the human, selected workspace, goal, orientation panels, and
   provenance-backed workstream.
6. The rendered page and `/api/call` response contained no `cft_` token,
   `CAMPFIRE_TOKEN`, or bearer credential.

The harness was not reloaded into a new agent conversation during this trace,
so this result does not replace Sprint 016's missing full Codex
prompt-to-Viewer evidence. It does establish Sprint 017's installed-harness
auto-connect and human-to-Viewer acceptance boundary.

---

## 5. Acceptance decision

**GO.** The quiet installer contract, human-only first run, local profile,
validated harness connection, token isolation, and live Viewer path all work.
The agent session remains explicit, exactly as required.

Not claimed: Gate B repeat usage, Gate C ordinary multi-participant value,
external adoption, product-market fit, or a hosted multi-tenant product.

Publication as `v1.5.0` is a backward-compatible minor release because it adds
the new default first-run experience and `campfire up` without breaking prior
commands or requiring a schema migration.
