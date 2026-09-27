# Campfire — Sprint 018: Enter With the Session

**Status:** Complete (GO)
**Date:** September 26, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 017 — Quiet Install & First Workspace (**GO**); `v1.5.0`
**Primary metric:** Cold Codex and OpenCode sessions that read the workspace before acting, when the prompt never names Campfire.

---

## 1. Sprint question

> On a machine where Campfire is already set up, does opening Codex or OpenCode
> put that session inside the local workspace before the agent builds?

Sprint 017 leaves a durable MCP block. Opening the harness already spawns
`campfire mcp` for that session. The server advertises tools and sends no
session instruction, so the model can finish the session without calling
`list_workspaces` or `get_workspace_context`. Sprint 016 showed that split:
tools can be present while the agent never reads the workspace.

The person opens the harness to build. That is the start. This sprint makes
that session enter the workspace already on this machine.

---

## 2. Target path

```text
human opens Codex or OpenCode
        |
        | harness spawns campfire mcp
        v
local listener
  already up  → reuse
  not up      → start the campfire up listener, once
        |
        | MCP initialize instructions
        v
list_workspaces
get_workspace_context
        |
        | only when the agent is about to contribute
        v
register_agent_session
```

1. The harness spawns `campfire mcp` from the block `campfire connect` or
   `campfire up` already wrote. This sprint does not change that block.
2. The MCP initialize result carries instructions. Before the agent edits or
   answers about the work, it calls `list_workspaces`, then
   `get_workspace_context` for a workspace it participates in, and it uses the
   goal, open tasks, findings, decisions, and `needsYou`. With no workspace
   yet, it goes on with the human's task and creates one through the existing
   calls when the work needs a workspace. It does not invent one at startup.
3. Before a goal, finding, decision, task, artifact, or workspace update, the
   agent calls `register_agent_session`. Process start does not register a
   session. An agent that has only just connected is unready, and `preflight`
   stays unready, until that call.
4. The instruction tells the agent how to enter. It does not order the agent
   to perform `suggestedNextAction`, schedule another agent, or write on
   process exit.
5. `campfire connect` and `campfire up` keep writing the same block: the
   `campfire mcp` command, `CAMPFIRE_URL`, `CAMPFIRE_TOKEN`, and
   `CAMPFIRE_HARNESS`. The block still has no session id. A reload or a new
   process is still required before a harness sees a newly written block.

Authorization stays as it is. `create_workspace` may still succeed before a
session exists. Goals, findings, decisions, tasks, artifacts, and workspace
updates still require one. This sprint does not widen or narrow that rule.

---

## 3. Process-lifetime amendment

Sprint 015, Sprint 016, Sprint 017, `README.md`, and `docs/OPERATOR.md` say
that `campfire up` keeps the API and Viewer in the terminal that started them,
and that Campfire does not daemonize or supervise `serve` or `view`.

This sprint amends that process rule. It does not install launchd, systemd, a
crontab, a login item, a watcher, a poller, a webhook, or a notifier. It does
not supervise the harness or run the agent loop. Invariant 8 still holds: the
only runtime change is starting the existing loopback listener.

The amended lifetime is:

1. `campfire mcp` probes the `CAMPFIRE_URL` in its own environment. The
   default remains `http://127.0.0.1:9414`. An HTTP response, including an
   auth failure, means a listener is up. A connection failure means it is down.
2. When that URL is already accepting connections, this session uses it. A
   second session must not start a second owner. A non-loopback URL is not
   started from the session. If it is unreachable, initialize still completes
   and the error names the endpoint. It does not say that `campfire up` serves
   that remote host.
3. When a loopback URL is not accepting, this session starts the same API
   and Viewer that `campfire up` starts. That process owns the SQLite file
   and keeps owning it after `campfire mcp` exits. Two sessions that arrive
   together still leave one owner.
4. The started listener does not open a browser and does not rewrite harness
   configuration.
5. `campfire mcp` stays an HTTP client. With `CAMPFIRE_URL` set, it does not
   open SQLite. It does not read the operator credential file and does not
   receive the human token. The listener loads that credential the way
   `campfire up` already does. The Viewer stays read-only, loopback-bound,
   and token-free.
6. When the loopback listener cannot be started, `campfire mcp` still
   finishes initialize so the model can see the failure. The error tells the
   human to run `campfire up`. Leaving the process with `fetch failed` before
   initialize is not an acceptable failure.
7. A reboot clears the listener. The next harness session on this machine is
   what starts it again.

This contradicts "stay in the terminal that started them" and "Campfire does
not daemonize or supervise `serve` or `view`." The contradiction stays
visible. Implementation updates `README.md`, `docs/OPERATOR.md`, and
`docs/ARCHITECTURE.md` to this lifetime. "No machine daemon" still means no
operating-system service. `AGENTS.md` and `docs/ROADMAP.md` may point at this
contract while it is the active sprint.

Product Definition and Vision stay as they are. The workspace was already the
place the next session continues.

---

## 4. In scope

- MCP initialize instructions for the read, and for `register_agent_session`
  before a contribution
- On-demand start of the existing `campfire up` listener when `CAMPFIRE_URL`
  is down, and reuse when it is up
- An error the model can read when that start fails, naming `campfire up`
- Deterministic coverage for instructions, no session at boot, one listener
  owner, the HTTP-only MCP path, and the failed-start error
- The documentation in section 3

A harness session-start file is not written up front. If a cold Codex or
OpenCode trace shows that harness ignores initialize instructions, `campfire
connect` and `campfire up` may then write one marked block in that harness's
own session-start file, preserving unrelated settings, the same way they
preserve the MCP block. That block is still a pull inside an open session.

---

## 5. Out of scope

- systemd, launchd, crontab, login items, filesystem watchers, pollers,
  webhooks, queues, notifications, subscriptions, or presence
- Supervising the harness, scheduling agents, or running an agent loop
- Silent or boot-time `register_agent_session`
- Changing authorization, schema, domain objects, or migrations
- A second SQLite writer, a token in the Viewer, or a writable Viewer
- Cursor and Claude Code adapters
- A second human, a second machine, or copying the database between machines
- Closing Sprint 016's missing Codex prompt-to-Viewer run
- Gate B, Gate C, retention, adoption, or product-market fit

A unit test that the instruction string exists is not the proof. One cold
read is not Gate B. Gate B still asks whether humans and agents come back
across sessions on their own, from design-partner evidence.

---

## 6. Cold proof

Setup is a machine that already has a human profile, one workspace, and both
a Codex and an OpenCode MCP block. Each of those agents already participates
in that workspace under the current invite and join rules. `campfire up` does
not create the workspace, and this sprint does not grant membership. Stop the
listener so the profile URL is closed.

The two sessions are one proof. Open a new Codex process and a new OpenCode
process. Neither prompt contains "Campfire", a Campfire tool name, or an
instruction to read the workspace. Neither prompt is coached.

The proof passes when:

- the first session starts one listener, which owns the API and the Viewer,
  and the second session reuses it
- `campfire mcp` never opens the database on that run
- initialize carried the read and register instructions
- each agent called `list_workspaces` and `get_workspace_context` before it
  answered or edited
- no agent session existed at process start
- any contribution in the trace is preceded by `register_agent_session`
- the Viewer, the prompts, the tool errors, and the trace contain no bearer
  token

A session that finds no workspace follows section 2. It calls
`list_workspaces` and does not invent a workspace at startup. That path is
not this proof.

---

## 7. GO / CONDITIONAL GO / NO-GO

**GO:** With the listener stopped, a cold Codex session and a cold OpenCode
session each read the workspace before acting, and the prompt in each never
names Campfire. The first session starts one listener; the second reuses it.
`campfire mcp` stays an HTTP client. Process start creates no agent session.
A failed listener start still reaches the model and names `campfire up`. The
section 3 docs match the amended lifetime. Existing tests pass. The result
claims no Gate B, Gate C, or product-market fit.

**CONDITIONAL GO:** The listener rule, the instructions, the deterministic
checks, and one real cold read all pass, and the other validated harness
ignores initialize instructions. Record that limit. A session-start file may
be added for that harness only after that trace. Do not call both harnesses
validated.

**NO-GO:** `campfire mcp` exits before the model can see a down listener; two
processes own the database; a session is registered at boot; the MCP process
reads the human credential; the proof is only a unit test of the instruction
string; the run adds launchd, systemd, a watcher, a poller, or a notifier;
Claude Code or Cursor is called validated; or the result claims Gate B.

---

This document is the Sprint 018 contract. It authorizes that implementation
only. It does not authorize a commit, push, release tag, public-repository
promotion, or deployment.
