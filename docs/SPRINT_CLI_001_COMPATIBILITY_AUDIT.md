# Campfire — CLI-001 Compatibility Audit

**Sprint:** CLI-001 — Agent-Native Interface Contract
**Audited baseline:** `v1.7.1` CLI behavior in `src/cli/` before CLI-001
**Date:** September 28, 2026

This is the inventory required by `docs/SPRINT_CLI_001.md` section 10. It records
the pre-change behavior of every command and the intended change, so the
output-default change is explicit rather than silent.

Baseline facts that apply to every row unless stated otherwise:

- **Exit status:** `0` on success, `1` on a structured or human failure. Long-running
  commands exit `0` only after a signal.
- **Stderr:** failures print `[Code] message` in human mode and
  `{"error":{"code","message"[,"details"]}[,"next":[]]}` under `--json`.
  Authorization/session diagnostics and long-running notices go to stderr.
  Successful data output goes to stdout.
- **`--json` before CLI-001:** dual-surface commands selected the existing JSON
  result; always-JSON commands accepted and ignored it (they already printed JSON);
  protocol commands accepted and ignored it.
- **Machine-readable documentation before CLI-001:** the README and global help
  said "every data-producing command honors `--json`"; explicit JSON was
  pretty-printed with two-space indentation.

## A. Human-default dual-surface commands (pre-change)

| Command | stdout before | `--json` before | Machine-readable documented | Long-running / protocol | CLI-001 change |
| --- | --- | --- | --- | --- | --- |
| `setup` | Human contract text | Contract object | Yes | No | `auto` piped emits the contract JSON; `--output human` restores text |
| `onboard` | Human receipt (no tokens) | Receipt object with one-time tokens | Yes | No | **Credential-safe exception:** `auto` renders the token-free human receipt even when piped; the token-bearing JSON receipt requires an explicit `--json` or `--output json` on that invocation |
| `connect` | Human confirmation | Plan object (no tokens) | Yes | No | `auto` piped emits the plan JSON |
| `doctor` | Human report plus copy-pasteable command | Report object | Yes | No | `auto` piped emits the report JSON |
| `handoff` | Human Viewer receipt | Receipt object | Yes | No | `auto` piped emits the receipt JSON |
| `up` | Wordmark summary | Summary object | Yes | Blocks after the summary | `auto` piped emits the summary JSON; notices stay on stderr |
| `status` | Local profile summary | Local profile summary object | Yes | No | **Semantics change:** live authorized `WorkspaceContext` overview; new versioned result and new human rendering |
| `bridge` | Human report | Report object | Yes | No | `auto` piped emits the report JSON |
| `show` | Orientation text | Service orientation object | Yes | No | `auto` piped emits the service JSON; explicit JSON is compact |
| `activity` | Contribution lines, truncation note on stderr | Activity page object | Yes | No | Workspace argument becomes optional via shared resolution; `auto` piped emits the page JSON |
| `preflight` | Readiness line | Readiness object | Yes | Hosted only | `auto` piped emits the readiness JSON |

## B. Always-JSON data and mutation commands (pre-change)

Commands: `whoami`, `list`, `init`, `bootstrap`, `seed`, `create-workspace`,
`update-workspace`, `create-goal`, `update-goal`, `add-finding`,
`add-decision`, `accept-decision`, `create-task`, `update-task`,
`add-artifact`, `create-human`, `create-agent`, `issue-token`,
`revoke-token`, `invite`, `join`.

| Property | Before | CLI-001 change |
| --- | --- | --- |
| stdout | One JSON value, two-space indentation | Compact single-line JSON value |
| `--json` | Accepted; no behavior change | Still accepted; same value |
| `--output human` | Flag did not exist | Rejected with `ValidationError`; the catalog declares JSON-only modes |
| Exit / stderr | `0` / `1`; human or structured failures | Failure envelope compact; human mode still available with `--output human` |
| Machine-readable documented | Yes (README/help) | Unchanged |

`issue-token`, `create-human`, `create-agent`, `bootstrap --human-name`, and
`onboard --output json` are the only successful results that contain a raw
one-time token; this did not change.

## C. Protocol-owned and long-running commands (pre-change)

| Command | stdout before | `--json` before | CLI-001 change |
| --- | --- | --- | --- |
| `serve` | No result document; notices on stderr | Ignored | None: protocol-owned, notices stay on stderr |
| `view` | No result document; notices on stderr | Ignored | None: protocol-owned, notices stay on stderr |
| `mcp` | MCP JSON-RPC on stdio | Ignored | None: protocol-owned |
| `help` | Usage text | Ignored | Usage text regenerated from the typed catalog and regrouped; still text |

## D. New surface added by CLI-001

`status` is redesigned, and `agents`, `decisions`, `changes`, `inspect`, and
`capabilities` are new. They read through the same application service and
return `version: 1` results with explicit `kind` values. `status` and
`capabilities` replace no existing command contract except the `status` JSON
and human shape, which this audit records as the intentional break.

## E. Required compatibility rules

1. `--json` continues to work wherever it worked before; covered by
   `tests/unit/cli.test.ts`, `tests/unit/cli-001.test.ts`, and
   `tests/integration/cli-hosted.test.ts`.
2. Existing command names and arguments remain accepted; `activity` now also
   accepts a omitted workspace, and no name was removed.
3. Existing successful JSON field semantics are unchanged except the audited
   `status` redesign; `show --json` still returns the service object.
4. Existing structured error envelopes are unchanged in shape; only whitespace
   and the auto-mode decision changed.
5. Token, profile, local/hosted, and single-writer behavior are unchanged.
6. `serve`, `view`, and `mcp` keep their stdout/stderr protocol boundaries.
7. Output-default changes are reversible with `--output human` and are covered
   by tests. Credential-bearing output is the one deliberate exception to the
   `auto` TTY rule: piped `onboard` stays human and token-free, so the
   token-bearing receipt never becomes an implicit pipe default.
8. Release classification is deferred: no release is tagged or published by
   this sprint.
