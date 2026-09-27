# Campfire

**The shared workspace where people and their agents work together.**

Campfire is a secure, harness-independent collaboration layer for teams working with AI agents. It stores structured work state — goals, tasks, findings, decisions, artifacts — not chat transcripts, so a second human-agent pair can continue from authorized team state.

- **Share work state** — goals, tasks, findings, decisions, and artifacts with provenance
- **Continue anywhere** — pick up work in a fresh session on any supported harness
- **Stay authorized** — invite-only workspaces; authorization precedes retrieval
- **Stay inspectable** — every mutation records who contributed what, when, and on whose behalf

Every data-producing command honors `--json` for machine-readable output — `show` and `activity` default to human text, the rest already print JSON, and failures under `--json` report a structured error object on stderr, with an optional sibling `next` array of copy-pasteable commands. The long-running `serve`/`view` commands, `mcp`, and `help` are the documented exceptions (they log notices, speak MCP JSON-RPC, or print usage text). Built for humans and agents alike.

---

## Quick start

Install, then run Campfire. A terminal first-run records the human once.
The name defaults from `git config user.name` or the login. Agents appear
when Codex or OpenCode is installed and `campfire up` is listening. The
agent in that session creates the workspace and goal. Past private sessions
are not imported. This does not register an agent session and does not
provision Cloudflare.

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
campfire
```

`campfire up` starts the local API and the read-only Viewer and writes a
Codex or OpenCode MCP block for each installed harness. Reload the harness
so MCP tools appear. On a loopback URL, opening that harness starts the same
listener when nothing is already listening, and that process keeps the
database after the session exits. A reboot stops it. `campfire mcp` stays an
HTTP client. The session instructions tell the agent to read the workspace
before it builds, and to call `register_agent_session` before it contributes.
Starting the process does not register a session.

Agents and scripts keep the non-interactive path:

```bash
campfire onboard \
  --human-name "Sergio" \
  --agent-name "Codex" \
  --harness codex \
  --workspace-name "billing deploy" \
  --goal "Ship the billing migration safely" \
  --json
campfire up --no-open
```

`--json` prints each credential once. Human-mode onboard does not. The human
token is stored for the operator CLI. The agent token is written into exactly
one harness process config. Do not put either token in the Viewer or a
handoff.

A second `onboard` refuses when humans or workspaces already exist and points
at `create-human`, `create-agent`, `create-workspace`, `create-goal`,
`invite`, and `join`. There is no reset flag. `campfire seed --reset` stays
available as a deterministic demo/evaluation fixture. It is not how a new
operator creates their workspace.

Run `campfire --help` for the grouped command list, or `campfire <command> --help` for one command. See [docs/PRODUCT_DEFINITION.md](docs/PRODUCT_DEFINITION.md) for the product thesis.

## Agent-led setup

An agent discovers the path from the installed binary with `campfire setup`. That command creates no state and prints no credential. `campfire onboard --json` remains the only command that prints one-time tokens. Human-mode onboard stores them locally instead. The human token is for operator administration. The agent token is for exactly one harness process.

`campfire connect --harness codex` or `--harness opencode` writes that harness's Campfire MCP block and leaves unrelated settings in place. After onboard it can read the agent token from the local credential store, so `--token` / `--config` / `--workspace` are optional. It stores the agent token in the config file and does not print it. A reload or a new harness process is required before MCP tools appear, and the harness may ask for approval. Claude Code and Cursor are not validated for this path.

`campfire doctor <workspaceId> --harness <name>` is read-only. It does not register a session or search for one. Capture the id returned by `register_agent_session` and pass it to hosted doctor with `--session` or `CAMPFIRE_SESSION_ID` (`--session` wins). When doctor reports ready, `campfire up` (or `campfire view`) serves the loopback journal and `campfire handoff` prints the workspace, goal, names, readiness, and Viewer URL. Do not put the session id or either token in that handoff. Campfire does not install a machine daemon and does not run the agent loop. A loopback harness session may start the existing listener; it does not install launchd, systemd, a watcher, or a supervisor, and it does not start a listener for a non-loopback URL.

---

## Commands

| Command | Description |
| --- | --- |
| `campfire` | Record the human once, or print status. Agents and workspaces appear when work starts |
| `campfire up` | Start the local API and Viewer; connect each installed Codex or OpenCode. Does not import past sessions |
| `campfire status` | Show the current workspace without credentials |
| `campfire setup` | Agent-readable setup contract. Creates no state and prints no credential |
| `campfire onboard` | First run: one human, one agent they own, one workspace, and one goal. Stores credentials locally. Does not start the server or register an agent session |
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

For a pinned v1.6.0 install after the versioned static asset is deployed:

```bash
curl -fsSL https://boringinfra.company/campfire/v1.6.0/install.sh | sh -s -- --version 1.6.0
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
- **Single SQLite writer.** The listener process owns the file; CLI and MCP adapters POST `/v1/call` with a bearer token. A loopback harness session starts that listener when it is not already running.
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
