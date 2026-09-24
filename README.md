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

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
campfire init
campfire seed --reset          # deterministic fixture
campfire show ws_billing_deploy
campfire serve                 # hosted HTTP API on 127.0.0.1:9414
```

Run `campfire --help` for the full command list. See [docs/PRODUCT_DEFINITION.md](docs/PRODUCT_DEFINITION.md) for the product thesis.

---

## Commands

| Command | Description |
| --- | --- |
| `campfire init` / `seed [--reset]` | Bootstrap org/team and load the deterministic fixture |
| `campfire list` / `show <workspace>` / `activity <workspace>` | Inspect workspaces and their contribution history |
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

For a pinned v1.1.0 install after the versioned static asset is deployed:

```bash
curl -fsSL https://boringinfra.company/campfire/v1.1.0/install.sh | sh -s -- --version 1.1.0
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
- **Team-use validation is pending.** Sprint 004 and 006 proved repeat-session and multi-participant behavior in deterministic traces; they did not measure multi-day human reuse or retention.

---

## Docs

- [docs/PRODUCT_DEFINITION.md](docs/PRODUCT_DEFINITION.md) — collaboration model and invariants
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — MCP → service → authorization → domain → SQLite
- [docs/ROADMAP.md](docs/ROADMAP.md) — evidence-backed stages toward team memory
- [docs/OPERATOR.md](docs/OPERATOR.md) — hosting, tokens, and the single-writer rule
- [docs/SPRINT_006_RESULT.md](docs/SPRINT_006_RESULT.md) — hosted multi-participant acceptance evidence for the v1.0 product cut

---

## Development

```bash
npm run typecheck
npm test
npm run acceptance   # deterministic two-harness run + evidence
```

Deploy: D1 `database_id` is never committed (`wrangler.toml` holds a
placeholder). Provision once with `wrangler d1 create campfire`, keep the id
in `$CAMPFIRE_D1_DATABASE_ID` or gitignored `wrangler.local.toml`, then
`npm run db:migrate` / `npm run pack:tarball` / `npm run deploy`. The Worker/D1
path is an available remote deployment slice; it does not establish the full
hosted-team Stage C gate. See [docs/OPERATOR.md](docs/OPERATOR.md)
("Deploy") for the one-time vs release split.

## License

Apache-2.0 — see [LICENSE](LICENSE).
