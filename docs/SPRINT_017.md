# Campfire — Sprint 017: Quiet Install & First Workspace

**Status:** In progress
**Date:** September 25, 2026
**Company:** Boring Infra Co.
**Depends on:** Sprint 016 — Agent-Led Setup & Human Handoff (**CONDITIONAL GO**); `v1.4.0`
**Primary metric:** Steps after `curl | sh` before a human sees the Viewer.

---

## 1. Sprint question

> Can a first-time operator install Campfire and reach a live workspace
> without exporting tokens, pasting MCP JSON, or keeping a six-step runbook?

Sprint 015/016 proved the underlying commands. The public installer still
prints the pre-onboard `issue-token` / env / MCP-snippet path. `campfire`
with no args dumps usage. That is the experience this sprint replaces.

Campfire is not a coding-agent TUI. This sprint copies the install grammar
of Grok / Claude / Amp / OpenCode (`curl | sh`, then run the product), not
their chat surfaces.

---

## 2. Target path

```text
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
campfire
```

TTY first-run asks only for the human. The default comes from
`git config user.name` or the login. It does not ask for an agent, a
workspace, or a goal.

1. stores the human credential locally (mode 0600)
2. `campfire up` starts `serve` and `view` in this CLI process
3. each installed Codex or OpenCode becomes an agent that human owns; the
   agent token is written only into that harness MCP block and is not printed
4. opens the loopback Viewer
5. tells the human that past sessions are not imported, and to reload the harness

The agent in the session creates the workspace and goal through the existing
service calls. A second workspace is normal. `campfire onboard` stays the
one-shot script path. Session registration stays explicit. The Viewer lists
workspaces that exist; with none, it says it is waiting for an agent to start
work.

`--json` / flags remain the agent path. Session registration stays an
explicit agent step. Tokens never enter the Viewer or human handoff.

---

## 3. In scope

- Quiet branded installer; next step is `campfire`
- Local profile + credential store
- Default database under XDG data, with `$CWD/.campfire/campfire.db` compat
- `campfire` with no args: human-only first run, or status
- `campfire up`: serve + view in-process, optional auto-connect, open Viewer
- Human onboard/handoff text that does not print tokens

## 4. Out of scope

- Native binary / dropping Node 22
- Cloud accounts, OAuth, or a hosted control plane
- Full-screen coding-agent TUI
- Silent `register_agent_session`
- systemd/launchd daemon install
- Cursor / Claude Code connect adapters (still unvalidated)

## 5. GO / CONDITIONAL GO / NO-GO

**GO:** cold `curl | sh` output names `campfire` only (no env/MCP homework);
TTY `campfire` or `campfire onboard` + `campfire up` reaches a loopback
Viewer; credentials are not printed in human text; `--json` still returns
one-time tokens; MCP still requires the agent token in the harness process;
existing tests pass.

**CONDITIONAL GO:** installer and `up` work, but harness auto-connect is
incomplete for a validated harness.

**NO-GO:** operators must still export `CAMPFIRE_TOKEN` or paste MCP JSON
to finish first run.
