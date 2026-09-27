# Campfire — Sprint 018 Result: Enter With the Session

**Status:** Complete
**Decision:** GO
**Date:** September 27, 2026
**Release:** `v1.6.0` minor release

---

## 1. Outcome

Sprint 018 is **GO**.

On a machine where Campfire is already set up, a new Codex session and a new
OpenCode session each read the workspace before acting. The prompt in each
session was:

```text
The billing deploy is in progress. Tell me the goal and what is still open.
```

That prompt does not name Campfire, a Campfire tool, or an instruction to
read the workspace. Both harnesses called `list_workspaces` and then
`get_workspace_context`. Both answers named the goal "Ship the billing
migration safely" and reported no open tasks, findings, or decisions.

No agent session existed at process start. Neither read registered one.
`campfire mcp` stayed an HTTP client. The listener that served the reuse
runs was one process, pid 45899, on `127.0.0.1:19718` and `127.0.0.1:9415`.
It stayed that pid while OpenCode and a later Codex session read. After the
MCP process that started it exited, the listener's parent was pid 1.

This is not Gate B. One cold read does not show that people come back across
sessions on their own.

---

## 2. Trace

Isolated config and database under `/tmp/campfire-018-proof`. One human, one
workspace (`billing deploy`), one goal, and both a Codex agent and an OpenCode
agent as participants. `agent_sessions` started empty and stayed empty.
Nothing was listening on port 19718 before the first session. The harness
block pointed at the local `dist/src/cli/index.js` with `CAMPFIRE_URL`,
`CAMPFIRE_TOKEN`, and `CAMPFIRE_HARNESS`. It did not set a session id.

1. Codex, with the listener stopped, started
   `campfire up --no-open --no-connect --host 127.0.0.1 --port 19718` and
   then called `list_workspaces` and `get_workspace_context`. That listener
   was stopped before the later runs.
2. A new `campfire mcp` process started the listener again. The listener
   remained after that process exited.
3. OpenCode called `campfire_list_workspaces` and
   `campfire_get_workspace_context` through that same listener. The pid did
   not change.
4. A second Codex session called `list_workspaces` and
   `get_workspace_context` through the same pid. Exit code 0. The pid was
   45899 before and after.

The final answers and the OpenCode transcript contain no bearer token. Codex
recorded the MCP environment it was given, including the agent token, in its
own command log. Campfire tool results did not include it. The proof listener
was stopped after the trace.

Codex also spent part of the first session in computer use before it called
Campfire. It still read the workspace before it answered. No session-start
file was added. OpenCode used the MCP instructions directly.

---

## 3. Automated verification

Node 22.23.2, before this result:

```text
npm run typecheck   PASS
npm test            PASS — 37 files / 381 tests
```

The deterministic checks cover initialize instructions, no session at boot,
one listener owner, the HTTP-only MCP path, and a down listener whose tool
error names `campfire up`.

---

## 4. Acceptance decision

**GO.** Both validated harnesses read the workspace from a prompt that does
not name Campfire. The listener starts when nothing is accepting, survives
the MCP process, and is reused. Process start does not register a session.
The amended lifetime is recorded in `README.md`, `docs/OPERATOR.md`, and
`docs/ARCHITECTURE.md`.

Not claimed: Gate B, Gate C, retention, adoption, product-market fit,
Claude Code, or Cursor.

---

## 5. Release promotion

The Sprint 018 result was promoted on September 27, 2026:

- Private source tag `v1.6.0` points to
  `d06cdd74f0ca21252dab2104b76689e83600834c`.
- The audited public snapshot is
  `9f3c13973654c17b609395a1502279c1934883ef`.
- Both public CI workflows passed. The public GitHub Release contains all four
  platform archives and their four SHA-256 checksum files.
- The production Worker deployment is
  `cd7793df-0d4a-4e5d-9de1-fe1a47492dd5` at
  `boringinfra.company/campfire/*`.
- A clean latest install from
  `https://boringinfra.company/campfire/install.sh` reported
  `Installed campfire 1.6.0` and wrote `~/.local/bin/campfire`. The verified
  macOS arm64 archive checksum was
  `8970a67076a22dd463caa7424ba0e9bd3dd8968e2a41636cf0f206687063684f`.
- `https://boringinfra.company/campfire/v1.6.0/install.sh` returned the same
  installer. No database migration ran because this release has no schema
  change.
