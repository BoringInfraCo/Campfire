# Campfire

**The shared workspace where people and their agents work together.**

Campfire is a secure, harness-independent collaboration layer for teams working with AI agents. It stores structured work state — goals, tasks, findings, decisions, artifacts — not chat transcripts, so a second human-agent pair can continue from authorized team state.

This checkout targets the **v1.9.0 candidate**: bring a new teammate into an
existing shared workspace with their own identities and agents. The independent
two-human acceptance trace is pending; v1.9 has not been published or deployed.
The published installer remains on v1.8 until release promotion.

- **Share work state** — goals, tasks, findings, decisions, and artifacts with provenance
- **Continue anywhere** — pick up work in a fresh session on any supported harness
- **Stay authorized** — invite-only workspaces; authorization precedes retrieval
- **Stay inspectable** — every mutation records who contributed what, when, and on whose behalf

Every command honors `--output auto|human|json`; `--json` remains a compatibility alias for `--output json`. Under `auto`, a command renders human text when stdout is a TTY and JSON when it is piped, and `CAMPFIRE_OUTPUT` sets the default mode. Explicit JSON prints exactly one compact JSON value on stdout; a failure prints a structured error object on stderr and exits 1. JSON-only administration commands always print JSON and reject `--output human`. `help` stays text, `mcp` speaks MCP JSON-RPC on stdio, and `serve`/`view` keep their operational notices on stderr with no synthetic result document. Read and inspection results never add token material. Only the credential-minting commands (`onboard`, `issue-token`, `create-human`, `create-agent`, and `bootstrap --human-name`) can print a one-time token, and `onboard` requires explicit `--json` or `--output json` for its credential receipt so a pipe cannot capture tokens by default. Built for humans and agents alike.

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

# Primary reads (same authorized result as human mode):
campfire status --output json
campfire agents --output json
campfire decisions --output json
campfire changes --since <contributionId> --output json
campfire inspect <kind> <id> --workspace <workspaceId> --output json
campfire capabilities --output json
```

`--json` prints each credential once. Human-mode onboard does not. Because the
receipt carries one-time credentials, `onboard` is the one dual-surface
command that stays human under `auto` even when piped: a piped `campfire
onboard` prints the token-free human receipt, and the JSON credential receipt
is opt-in with `--json` or `--output json`. The human token is stored for
the operator CLI. The agent token is written into exactly one harness process
config. Do not put either token in the Viewer or a handoff.

A second `onboard` refuses when humans or workspaces already exist and points
at `create-human`, `create-agent`, `create-workspace`, `create-goal`,
`invite`, and `join`. There is no reset flag. `campfire seed --reset` stays
available as a deterministic demo/evaluation fixture. It is not how a new
operator creates their workspace.

## Join existing team work

Use an already provisioned, reachable Campfire instance. An authenticated human
workspace owner creates a private invitation for one new teammate:

```bash
campfire invite-teammate <workspaceId> --out ./alice.invitation.json
```

The owner transfers that file privately. It contains single-use enrollment
authority for this workspace, expires after 24 hours by default, and contains
neither the owner's credentials nor a copy of their work. Anyone holding the
file can claim it; the recipient's display name is not verified identity.

On the recipient's machine, using a fresh or isolated Campfire profile:

```bash
campfire join --invitation-file ./alice.invitation.json \
  --human-name "Alice" --harness opencode
campfire status
campfire up
```

Select both supported harnesses by repeating `--harness codex --harness opencode`.
Join stores the recipient's own credentials and prepares their MCP connections;
reload the harness and approve its normal tool access. Remote `up` serves a
local read-only journal of the shared backend. It creates no local collaboration
database or second shared API. Normal commands use the saved remote profile.

The incoming agent reads the existing goal, decisions, blockers, findings and
provenance before acting, and explicitly registers its own session before
contributing. An additional supported harness can be enrolled later:

```bash
campfire connect --harness codex --enroll
# Reapply an already enrolled connection without creating another identity:
campfire connect --harness codex
```

Retry interrupted join with the same file, human name, selected harnesses and
profile directory. Private pending state preserves the original prepared
credentials. Use `CAMPFIRE_CONFIG_DIR` for an isolated profile when one already
exists; unrelated profiles and harness configuration are not silently replaced.
The owner can cancel enrollment authority with
`campfire revoke-invitation <invitationId> --workspace <workspaceId>`; this does
not remove an already enrolled participant. Legacy existing-actor `invite` and
`join <workspaceId>` remain available. See [the operator runbook](docs/OPERATOR.md).

Run `campfire --help` for the grouped command list — **Start and connect**, **Understand the workspace**, **Recover and hand off**, **Discover the CLI**, and **Administration** — or `campfire <command> --help` for one command. Existing lower-level commands remain available under Administration. See [docs/PRODUCT_DEFINITION.md](docs/PRODUCT_DEFINITION.md) for the product thesis.

## Agent-led setup

An agent discovers the path from the installed binary with `campfire setup`. That command creates no state and prints no credential. `campfire onboard --output json` remains the setup path that prints one-time tokens (`--json` still works as an alias); human-mode onboard stores them locally instead. The human token is for operator administration. The agent token is for exactly one harness process.

For the shell fallback, an agent can run `campfire capabilities --output json` to discover the installed commands and `campfire status --output json` to read the live workspace overview.

`campfire connect --harness codex` or `--harness opencode` writes that harness's Campfire MCP block and leaves unrelated settings in place. After onboard it can read the agent token from the local credential store, so `--token` / `--config` / `--workspace` are optional. It stores the agent token in the config file and does not print it. A reload or a new harness process is required before MCP tools appear, and the harness may ask for approval. Claude Code and Cursor are not validated for this path.

`campfire doctor <workspaceId> --harness <name>` is read-only. It does not register a session or search for one. Capture the id returned by `register_agent_session` and pass it to hosted doctor with `--session` or `CAMPFIRE_SESSION_ID` (`--session` wins). When doctor reports ready, `campfire up` (or `campfire view`) serves the loopback journal and `campfire handoff` prints the workspace, goal, names, readiness, and Viewer URL. Do not put the session id or either token in that handoff. Campfire does not install a machine daemon and does not run the agent loop. A loopback harness session may start the existing listener; it does not install launchd, systemd, a watcher, or a supervisor, and it does not start a listener for a non-loopback URL.

---

## Commands

| Command | Description |
| --- | --- |
| `campfire` | Interactive first-run human path: record the human once, then report the local profile. Use `campfire status` for the live, machine-readable overview |
| `campfire up` | Start the local API and Viewer; connect each installed Codex or OpenCode. Does not import past sessions |
| `campfire status [workspace]` | Live authorized workspace overview built from the authorized WorkspaceContext: goal, work counts, decisions, participants, attention, and the newest contribution cursor. Not a local-profile summary |
| `campfire agents [workspace]` | Recorded agent participants with role, harness, human owner, and joined time. Never a presence label |
| `campfire decisions [workspace]` | One page of decisions. Default page size is 100. `--limit`, `--cursor`, and `--status` continue the list. The page reports total, returned, and truncated |
| `campfire context [workspace]` | Bounded orientation, the same read as `show` without `--full`. Truncated sections say how many rows are showing |
| `campfire catch-up [workspace] --after <cursor>` | Changes after an orientation or catch-up cursor. Material changes come first. Pass the returned cursor to continue |
| `campfire findings` / `tasks` / `artifacts [workspace]` | One bounded page of that object. `tasks` accepts `--status`. `findings` accepts `--currentness current\|superseded\|withdrawn\|all` and defaults to current. Pass `--cursor` to continue |
| `campfire changes [workspace] [--since <contributionId>]` | Contributions after a contribution id, or the recent provenance window, plus the cursor to retain next |
| `campfire inspect <kind> <id> --workspace <workspaceId>` | Inspect one workspace object by kind and id. Task, finding, decision, and artifact reads load that object. No cross-workspace lookup |
| `campfire capabilities` | The installed CLI command manifest for shell discovery; not the future Campfire Capability domain object |
| `campfire telemetry status\|enable\|disable` | Show or change anonymous product telemetry. Sends only the installation id, Campfire version, OS, architecture, and surface counters; never content, paths, or identity |
| `campfire setup` | Agent-readable setup contract. Creates no state and prints no credential |
| `campfire onboard` | First run: one human, one agent they own, one workspace, and one goal. Stores credentials locally. Does not start the server or register an agent session |
| `campfire connect` | Write a Codex or OpenCode MCP block for the agent token. Requires a reload or new process |
| `campfire doctor <workspace>` | Read-only setup diagnosis. Does not register a session |
| `campfire handoff <workspace>` | Non-secret Viewer receipt. The browser stays token-free |
| `campfire init` / `seed [--reset]` | Bootstrap org/team; `seed --reset` loads the deterministic demo/evaluation fixture, not a new operator workspace |
| `campfire list` / `show <workspace>` / `activity <workspace>` | `show` is the bounded orientation. `show --full` remains the full inspector. `show --since <contributionId>` adds the delta since that observation. `activity` is the contribution history |
| `campfire create-workspace` / `create-goal` / `create-task` | Shape the work (goals, tasks with explicit lifecycle) |
| `campfire add-finding` / `add-decision` / `add-artifact` | Contribute structured state with provenance. `add-decision --replaces <decisionId>` proposes a successor and leaves the accepted decision unchanged |
| `campfire correct-finding` / `withdraw-finding` | Record a new finding that corrects an earlier one, or withdraw it with a reason. The old summary and detail stay |
| `campfire cite-evidence` / `uncite-evidence` | Attach or remove one artifact evidence link (`supports` or `contradicts`) on a finding |
| `campfire cite-basis` / `uncite-basis` | Attach or remove one finding citation on a decision |
| `campfire accept-decision` / `retire-decision` | Accept a proposal, optionally with `--reason`. Retire a proposed or accepted decision with a required reason. Accepting a replacement supersedes its predecessor |
| `campfire create-human` / `create-agent` / `issue-token` | Manage distinct human and agent identities |
| `campfire invite` / `join` | Grant and accept invite-only workspace membership |
| `campfire invite-teammate` / `join --invitation-file` | Owner authorizes one new human; recipient enrolls their own supported agents into existing shared work |
| `campfire revoke-invitation` | Cancel enrollment authority without removing existing participants |
| `campfire serve` / `view` | Host the HTTP API and the read-only team journal |
| `campfire preflight <workspaceId>` | Validate hosted endpoint, token, identity, workspace access, and agent-session readiness without mutation |
| `campfire mcp` | Expose the same application service over MCP stdio |

---

## Installation

Requires Node.js **22 or newer**. SQLite is the store; one process owns the file, others call it over HTTP.

```bash
curl -fsSL https://boringinfra.company/campfire/install.sh | sh
```

For the production-deployed pinned v1.8.0 installer:

```bash
curl -fsSL https://boringinfra.company/campfire/v1.8.0/install.sh | sh -s -- --version 1.8.0
```

The v1.9.0 source snapshot and GitHub Release are published. Its Worker assets,
including the versioned installer URL, have not yet been promoted to production.
`v1.11.0` is published, CONDITIONAL GO. `public/campfire/v1.11.0/install.sh`
is tracked here and is not a live production URL until a later deploy.

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
- **v1.9 candidate acceptance is pending.** Enrollment engineering checks and the required independent two-human trace have separate verdicts in [Sprint 020 result](docs/SPRINT_020_RESULT.md). No v1.9 release promotion has occurred.

---

## Telemetry

Campfire records five anonymous events so it can tell whether the project is being installed, activated, used again, and joined by a teammate: `install_requested`, `install_completed`, `activated`, `active`, and `teammate_joined`. A payload carries a random local installation id plus Campfire version, OS, architecture, install method, surface, and closed harness (`codex` or `opencode`), and nothing else. The Worker also stores country-level region, installer route, and a coarse client family on installer fetches, and country on successful installs. There is no dashboard and no third-party analytics SDK.

- **No content.** No prompts, messages, code, diffs, findings, decisions, goals, task or artifact contents, file paths, or repository, branch, workspace, and team names.
- **No identity.** No name, email, handle, hostname, machine fingerprint, or IP address. Installer fetches record a country code (`US`, `CA`, `MX`, …), not a city or precise location.
- **No credentials.** No tokens, keys, secrets, or raw command arguments.
- **Enforced by an allow-list, not by policy.** Every payload is built from a fixed field list, and the endpoint rejects any undocumented field.
- **An installation, not a person.** The id is a random UUID generated locally; a deduplicated count is an anonymous installation.
- **Off on request.** `campfire telemetry disable`, or `CAMPFIRE_TELEMETRY=0` for a single invocation. One honest exception: the installer fetch itself is recorded by the Worker before any Campfire code exists on the machine, so it cannot be suppressed locally.

The full disclosure, including how the installation id is created and where the local state lives, is [docs/TELEMETRY.md](docs/TELEMETRY.md).

---

## Docs

- [docs/PRODUCT_DEFINITION.md](docs/PRODUCT_DEFINITION.md) — collaboration model and invariants
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — MCP → service → authorization → domain → SQLite
- [docs/ROADMAP.md](docs/ROADMAP.md) — evidence-backed stages toward team memory
- [docs/OPERATOR.md](docs/OPERATOR.md) — hosting, tokens, and the single-writer rule
- [docs/TELEMETRY.md](docs/TELEMETRY.md) — what anonymous product telemetry collects, why, and how to disable it
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
