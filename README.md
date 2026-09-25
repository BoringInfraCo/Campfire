# Campfire

**The shared workspace where people and their agents work together.**

Campfire is a secure, harness-independent collaboration layer for teams working with AI agents. It stores structured work state — goals, tasks, findings, decisions, artifacts — not chat transcripts, so a second human-agent pair can continue from authorized team state.

- **Share work state** — goals, tasks, findings, decisions, and artifacts with provenance
- **Continue anywhere** — pick up work in a fresh session on any supported harness
- **Stay authorized** — invite-only workspaces; authorization precedes retrieval
- **Stay inspectable** — every mutation records who contributed what, when, and on whose behalf

Every data-producing command honors `--json` for machine-readable output — `show` and `activity` default to human text, the rest already print JSON, and failures under `--json` report a structured error object on stderr. The long-running `serve`/`view` commands, `mcp`, and `help` are the documented exceptions (they log notices, speak MCP JSON-RPC, or print usage text). Built for humans and agents alike.

---

## Quick start

This is the path from an installed binary to one human, one agent they own, one workspace, and one goal. Onboard does not start the server and does not register an agent session. It prints each credential once, writes only the local database (`--db` or `CAMPFIRE_DB`), and does not provision Cloudflare.

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
campfire onboard \
  --human-name "Sergio" \
  --agent-name "Codex" \
  --harness codex \
  --workspace-name "billing deploy" \
  --goal "Ship the billing migration safely"
CAMPFIRE_DB=<absolute path printed by onboard> campfire serve
```

The human token is for the operator CLI and administration. The agent token is for exactly one harness process. Point that process at `CAMPFIRE_URL`, `CAMPFIRE_TOKEN` (the agent token printed above), and `CAMPFIRE_HARNESS`. The agent calls `register_agent_session`, then `preflight`, then reads workspace context.

A second `onboard` refuses when humans or workspaces already exist and points at `create-human`, `create-agent`, `create-workspace`, `create-goal`, `invite`, and `join`. There is no reset flag. `campfire seed --reset` stays available as a deterministic demo/evaluation fixture. It is not how a new operator creates their workspace.

Run `campfire --help` for the full command list. See [docs/PRODUCT_DEFINITION.md](docs/PRODUCT_DEFINITION.md) for the product thesis.

## Agent-led setup

An agent discovers the path from the installed binary with `campfire setup`. That command creates no state and prints no credential. `campfire onboard` remains the only command that prints one-time tokens. The human token is for operator administration. The agent token is for exactly one harness process.

`campfire connect --harness codex` or `--harness opencode` writes that harness's Campfire MCP block and leaves unrelated settings in place. It stores the agent token in the config file and does not print it. A reload or a new harness process is required before MCP tools appear, and the harness may ask for approval. Claude Code and Cursor are not validated for this path.

`campfire doctor <workspaceId> --harness <name>` is read-only. It does not register a session or search for one. Capture the id returned by `register_agent_session` and pass it to hosted doctor with `--session` or `CAMPFIRE_SESSION_ID` (`--session` wins). When doctor reports ready, `campfire view` serves the loopback journal and `campfire handoff` prints the workspace, goal, names, readiness, and Viewer URL. Do not put the session id or either token in that handoff. Campfire does not daemonize those processes and does not run the agent loop.

---

## Commands

| Command | Description |
| --- | --- |
| `campfire setup` | Agent-readable setup contract. Creates no state and prints no credential |
| `campfire onboard` | First run: one human, one agent they own, one workspace, and one goal. Does not start the server or register an agent session |
| `campfire connect` | Write a Codex or OpenCode MCP block for the agent token. Requires a reload or new process |
| `campfire doctor <workspace>` | Read-only setup diagnosis. Does not register a session |
| `campfire handoff <workspace>` | Non-secret Viewer receipt. The browser stays token-free |
| `campfire init` / `seed [--reset]` | Bootstrap org/team; `seed --reset` loads the deterministic demo/evaluation fixture, not a new operator workspace |
| `campfire list` / `show <workspace>` / `activity <workspace>` | Inspect workspaces and their contribution history; `show --since <contributionId>` adds the delta since that observation and the newest id to retain |
| `campfire create-workspace` / `create-goal` / `create-task` | Shape the work (goals, tasks with explicit lifecycle) |
| `campfire add-finding` / `add-decision` / `add-artifact` | Contribute structured state with provenance |
| `campfire create-human` / `create-agent` / `issue-token` | Manage distinct human and agent identities |
| `campfire invite` / `join` | Grant and accept invite-only workspace membership |
| `campfire serve` / `view` | Host the HTTP API and the read-only team journal |
| `campfire preflight <workspaceId>` | Validate hosted endpoint, token, identity, workspace access, and agent-session readiness without mutation |
| `campfire mcp` | Expose the same application service over MCP stdio |

---

## Installation

Requires Node.js **22 or newer**. SQLite is the store; one process owns the file, others call it over HTTP.

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
```

For a pinned v1.3.0 install after the versioned static asset is deployed:

```bash
curl -fsSL https://boringinfra.company/campfire/v1.3.0/install.sh | sh -s -- --version 1.3.0
```

Or build from source:

```bash
npm ci
npm run build
npm test
```

The package stays `private: true` and is **not published to npm**; distribution is via the install script and GitHub Release assets. The installer verifies the release tarball checksum before installing. The versioned script requires the static-site deploy as well as the GitHub Release assets; see [docs/OPERATOR.md](docs/OPERATOR.md).

---

## Harnesses

| Harness | Connects via | Status |
| --- | --- | --- |
| Codex | MCP | Real cross-harness run with OpenCode |
| OpenCode | MCP | Real cross-harness run with Codex |
| Claude Code | MCP | MCP-compatible; live handoff validation pending |
| Cursor / internal agents | MCP | MCP-compatible; live handoff validation pending |

Harness-specific logic lives at the MCP adapter boundary; the domain model never depends on a vendor session schema. Each harness runs its own server process with its own actor identity.

---

## Limitations

- **No transcript sync.** Campfire stores structured state, never raw conversation history.
- **Workspace-scoped.** State belongs to an explicit workspace; there is no org-wide memory pool.
- **Invite-only.** Retrieval is authorized before it crosses the boundary; no token, no state.
- **Single SQLite writer.** The hosted `serve` process owns the file; CLI and MCP adapters POST `/v1/call` with a bearer token.
- **Viewer is read-only.** `campfire view` is a loopback team journal; the browser never holds a token.
- **Worker serves the API and downloads.** The remote Worker/D1 path does not serve a hosted browser journal.
- **External team-use validation is not measured.** Field Trace 001 was cancelled by founder decision; Sprint 004/006 remain controlled product-surface evidence, not retention or PMF evidence.

---

## Docs

- [docs/PRODUCT_DEFINITION.md](docs/PRODUCT_DEFINITION.md) — collaboration model and invariants
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — MCP → service → authorization → domain → SQLite
- [docs/ROADMAP.md](docs/ROADMAP.md) — evidence-backed stages toward team memory
- [docs/OPERATOR.md](docs/OPERATOR.md) — hosting, tokens, and the single-writer rule
- [docs/SPRINT_006_RESULT.md](docs/SPRINT_006_RESULT.md) — hosted multi-participant acceptance evidence for the v1.0 product cut
- [docs/SPRINT_007_RESULT.md](docs/SPRINT_007_RESULT.md) — harness readiness preflight result
- [docs/SPRINT_008_RESULT.md](docs/SPRINT_008_RESULT.md) — Enter the Room result (GO; Time to Context 19.8 s)
- [docs/SPRINT_009_RESULT.md](docs/SPRINT_009_RESULT.md) — Align Before Execution result (GO)
- [docs/SPRINT_010_RESULT.md](docs/SPRINT_010_RESULT.md) — Return to the Workspace result (GO)

---

## Development

Campfire uses a release-mirror repository model. Canonical development happens
in the private `BoringInfraCo/Campfire-internal` repository. Reviewed release
snapshots are exported with clean public history to
`BoringInfraCo/Campfire`; normal development never pushes directly to that
mirror. Run `npm run export:public -- --ref <release-tag> --output <directory>`
to produce an audited snapshot from a committed release ref.

```bash
npm run typecheck
npm test
npm run acceptance   # deterministic two-harness run + evidence
```

Deploy: D1 `database_id` is never committed (`wrangler.toml` holds a
placeholder). Provision once with `wrangler d1 create campfire`, keep the id
in `$CAMPFIRE_D1_DATABASE_ID` or gitignored `wrangler.local.toml`, then
`npm run db:migrate` / `npm run pack:tarball` / `npm run deploy`. Both
`db:migrate` and `deploy` resolve the id through the same credential-safe
wrapper and fail closed before contacting Cloudflare without a
non-placeholder id. The Worker/D1 path is an available remote deployment
slice; it does not establish the full hosted-team Stage C gate. See
[docs/OPERATOR.md](docs/OPERATOR.md) ("Deploy") for the one-time vs release
split.

## License

Apache-2.0 — see [LICENSE](LICENSE).
