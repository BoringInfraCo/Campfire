# VIS-001 gate condition 1 — live cold-agent evidence on a shared workspace beyond one machine

**Date:** 2026-10-04 (UTC)
**Verdict for this condition:** MET (live cold-agent runs against a shared instance
that is not this machine's local SQLite fixture).

## Why this satisfies the condition

The roadmap condition asked for "live cold-agent evidence against a realistically large
workspace, beyond the single-machine CTX-001 gate", and the sprint doc specified that
"A larger synthetic fixture on the same machine does not satisfy this condition."

- The workspace store and the serving process are **remote** (Cloudflare Worker + D1,
  `https://campfire-vis-001-probe.sunbeam-redraft-7j.workers.dev`), not a local SQLite file
  served over loopback. The agents connected over the public internet to a shared backend.
- Two independent cold harnesses (Codex 0.150.1 and OpenCode 1.18.34) each ran with an
  isolated config containing only the Campfire MCP server, pointing at the remote URL with
  a real agent bearer token. Neither received a prepared summary.
- This is NOT a production promotion. A separate Worker (`campfire-vis-001-probe`) and a
  separate D1 database (`campfire_vis001_probe`) were created for the probe. The production
  `campfire` Worker, its `boringinfra.company/campfire/*` route, and the production D1
  `campfire` were not touched. The probe resources are temporary and slated for deletion.

## Workspace size and authorization boundary

Workspace `ws_e844657c1dcc4e5a` ("Harbor incident", goal "Restore a trustworthy March export"),
seeded from the COR-001 gate state plus the visit-2 changes:

- findings 16, decisions 15, tasks 22, artifacts 15, contributions 102 (append positions 1..99)
- current findings include the corrected reload-window finding and a newer "reload window repeats
  nightly" finding; one accepted decision is flagged `needsReview`
- a second workspace `ws_6be7cb2aad9a4560` ("Vault ledger") holds a sentinel finding and belongs to
  a different human; the cold agents are not participants

Boundary behavior observed (agent identity `agt_733f93f0ff09430a` / `agt_cce432a8b91341f9`):

- no token -> HTTP 401
- agent token -> identity resolved via `whoami`; `list_workspaces` returns Harbor only
- `get_workspace_context` on the Vault -> `ParticipantRequired` (HTTP 403)
- `get_finding` on the Vault's sentinel finding -> `ParticipantRequired` (HTTP 403), no content

Sentinel leak check: the string `VAULT_SENTINEL_do_not_leak` exists in the shared store but does
NOT appear in either agent transcript or stderr. Authorization occurred before retrieval.

## Operations performed (Codex cold run, from its tool trace)

`whoami` -> `list_workspaces` -> `get_workspace_context` (x2) -> `list_findings` ->
`list_decisions` -> `list_tasks` -> `list_artifacts` -> `get_decision` (x2) -> `get_finding` (x2)
-> `get_workspace_context` (failed: the denial attempt). The agent reached the operative current
decision, the needs-review decision, the next in-progress task, and the newest artifact purely
through authorized drill-down reads, and reported orientation truncation
(findings 16/10, decisions 14/10, tasks 22/20, artifacts 15/10 — all truncated).

## Outcome

- Cold Codex: named the operative current decision `dec_f9bd16ad4d8f44e6`, the needs-review
  decision `dec_80dad7d77e47449d` (citing superseded `find_d64c878a8016415a`), the in-progress next
  task `task_235f9612e64c4b20`, and artifact `art_6e027ba110f04336`. Its authorization probe hit an
  inferred nonexistent id (`WorkspaceNotFound`), so it did not exercise the real Vault denial.
- Cold OpenCode: independently named the same operative decision, the same needs-review decision,
  and correctly probed the real Vault boundary twice (`ParticipantRequired`, HTTP 403) with no
  content leakage.

Both cold agents agreed on the operative current decision and on the needs-review decision, and
both correctly identified the next action and the artifact reference.

Raw evidence: `probe-codex-last.md`, `probe-codex.err`, `probe-opencode-last.md`,
`probe-opencode.err` under `.campfire/traces/harbor/` (gitignored). Prompts:
`probe-prompt.txt`, `probe-prompt-opencode.txt`.
