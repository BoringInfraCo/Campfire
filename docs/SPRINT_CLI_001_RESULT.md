# Campfire — Sprint CLI-001 Result: Agent-Native Interface Contract

**Status:** Complete
**Decision:** GO
**Date:** September 28, 2026
**Release:** `v1.8.0` minor release — published and deployed

---

## 1. Outcome

Sprint CLI-001 is **GO**.

The Campfire CLI now presents one authorized workspace model through one
output contract for both humans and agents:

- `--output auto|human|json` with `--json` as a compatibility alias and
  `CAMPFIRE_OUTPUT` as the environment default;
- `auto` renders human text on a TTY and compact JSON when stdout is not a TTY;
- `campfire status` is the live authorized `WorkspaceContext` overview, not a
  local-profile summary;
- `agents`, `decisions`, `changes`, `inspect`, and `capabilities` are added;
- every command is declared in one typed catalog that drives recognition,
  grouping, usage, mutability, workspace scoping, output modes, and the
  manifest;
- human renderers and JSON results are produced from the same command result.

This is interface-contract evidence only. It is not Gate B, Gate C, Gate F,
presence, coordination, adoption, or product-market evidence.

---

## 2. What shipped

- `src/cli/catalog.ts` — typed command catalog for all 41 commands, grouped
  help, global output notes, and per-command help.
- `src/cli/args.ts` — argument parsing with repeated-flag occurrences.
- `src/cli/output.ts` — output resolution, conflict validation, TTY selection,
  protocol-command treatment, credential-safe auto behavior, and error-mode
  selection.
- `src/cli/projections.ts` — versioned result builders and human renderers for
  `workspace_status`, `workspace_agents`, `workspace_decisions`,
  `workspace_changes`, `workspace_inspect`, and `cli_command_manifest`.
- `src/cli/index.ts` — a dispatch map keyed by the catalog, shared workspace
  resolution, live status, the new read commands, and compact JSON output.
- `src/cli/recovery.ts` — compact structured failures plus recovery guidance
  for output-mode and workspace-selection errors.
- `src/mcp/instructions.ts` — one CLI-discovery sentence pointing at
  `campfire capabilities --output json` and `campfire status --output json`.
- `README.md`, `docs/OPERATOR.md`, and grouped `campfire --help` document the
  primary surface and output rules.
- `docs/SPRINT_CLI_001_COMPATIBILITY_AUDIT.md` records the required command
  matrix and the intentional output-default changes.

No domain object, SQLite or D1 schema, authorization rule, Contribution or
DomainEvent semantic, Viewer behavior, or MCP tool semantic changed. No new
runtime dependency was added.

---

## 3. Compatibility

The audit found exactly one intentional semantic break: `campfire status`
changed from a local-profile summary to the live authorized workspace
overview. Its JSON shape and human rendering are redesigned and tested.

Documented default changes, all reversible with `--output human`:

- dual-surface commands piped under `auto` now emit JSON;
- failures under that resolved JSON mode use the existing structured envelope;
- explicit JSON is compact;
- JSON-only administration commands reject `--output human`.

`onboard` is the deliberate exception because its JSON result carries one-time
credentials: under `auto` it always renders the token-free human receipt, even
when piped, and the credential receipt requires an explicit `--json` or
`--output json` on that invocation. `CAMPFIRE_OUTPUT` is ambient configuration
and does not opt in.

`--json`, existing command names and arguments, service JSON objects for
`show`/`activity`, structured error shapes, token/profile/local/hosted
behavior, and the `serve`/`view`/`mcp`/`help` protocol boundaries remain
compatible.

---

## 4. Review remediation

Independent verification supported the GO and raised one pre-release concern:
a piped `campfire onboard` implicitly emitted the token-bearing JSON receipt
under `auto`. That is fixed. Credential-bearing results are now classified in
the command catalog (`credentials: true`, currently only `onboard`); under
`auto` they stay human and token-free even when piped, and the credential
receipt requires an explicit `--json` or `--output json`. `CAMPFIRE_OUTPUT`
does not opt in. Automated coverage records the piped human receipt, the
explicit JSON receipt, and the ignored ambient mode.

---

## 5. Traces

### Human terminal trace

PASS. A real PTY ran `status`, `agents`, `decisions`, `changes`, and two
`inspect` reads against a seeded local workspace. Output was concise,
credential-safe, and consistent with `show --json`. Piping each dual-surface
command under `auto` produced exactly one compact JSON value. A hosted
listener at `CAMPFIRE_URL` returned semantically identical `status`, `agents`,
`decisions`, and `changes` results.

Evidence: `evidence/sprint-cli-001/human-terminal-trace.md` and the captured
`human-tty-*.txt`, `pipe-*.json`, and `hosted-*.json` files. `evidence/` is
intentionally gitignored, so these captures are private working-tree artifacts
rather than part of a published snapshot.

### Cold-agent CLI-only trace

PASS. A fresh `opencode` 1.18.33 session with no Campfire MCP tools and the
built binary on `PATH` received the sprint prompt without a subcommand name.
It discovered the surface through `campfire --help`, selected the authorized
workspace, used `--output json`, accurately reported the goal, blocked work,
accepted decision, participating agent, and the empty post-cursor delta, and
retained the resume cursor. It performed no mutation (11 contributions and the
same newest cursor before and after), read no database file directly, and made
no presence or file-activity claim.

Evidence: `evidence/sprint-cli-001/cold-agent-cli-trace.md` and
`cold-agent-trace.json`.

---

## 6. Automated verification

- `npm run typecheck` — passed.
- `npm test` — 44 files, 504 tests passed, including:
  - `tests/unit/cli-001.test.ts` — output selection, projection parity,
    command semantics, security/privacy, and compatibility contracts;
  - `tests/integration/cli-hosted.test.ts` — local/hosted parity over a real
    loopback server;
  - existing CLI, onboarding, listener, MCP, HTTP, Viewer, continuation,
    lifecycle, bridge, and installer suites.
- Catalog and dispatch tests fail when a dispatched command is absent from the
  catalog or a catalogued command has no dispatch path.
- Existing acceptance tests pass without a TTY.

---

## 7. Explicit non-claims

This sprint does not establish Gate B repeat usage, Gate C ordinary
multi-participant value, Gate D authorization need, Gate F controlled action,
participant presence, team memory, coordination, capabilities, or
product-market fit. It introduces no Huddle object, checkpoint, presence
model, heartbeat, file-editing view, orchestration, natural-language command
search, JSON Lines, SDK, or new persistence.

---

## 8. Release promotion

Release promotion completed on September 28, 2026 as `v1.8.0`:

- Private canonical source commit and annotated tag:
  `547af7922507d594621c652607dfdd1cd6fce3da` / `v1.8.0`.
- The tag exported 191 allowlisted files. Private sprint documents, local
  evidence, credentials, databases, and private history were excluded.
- A clean exported snapshot passed `npm ci`, type-check, and the full 44-file /
  504-test suite before promotion.
- Public snapshot commit: `38005350d752566f8a2f4d5f9323e379fc14051d`.
- Public source tag and GitHub Release:
  <https://github.com/BoringInfraCo/Campfire/releases/tag/v1.8.0>.
- Public main and tag CI passed. Release workflow `36503610607` built,
  checksum-verified, and attached Darwin and Linux archives for ARM64 and x64.
- No D1 migration ran because CLI-001 has no schema change.
- Production Worker/assets deployed successfully as version
  `5ff8b331-336c-4b96-8da5-8ff5b5088cc1`.
- The live latest and pinned `v1.8.0` installer URLs matched their tracked
  sources. A clean pinned install verified its archive checksum, reported
  Campfire `1.8.0`, and exposed the new capabilities manifest.

The release does not upgrade the sprint's product-evidence claims. Gate B,
Gate C, and Gate F remain unmeasured.
