# CAP-001 Step 0 compatibility snapshot

**Date:** 2026-10-20  
**Label: FIXTURE EVIDENCE.** Not a release decision.

Captured on this checkout, whose `src/` and `package.json` match release source `a013d4f1055f56686f5cb9fc3e67e87a41a99364` (annotated tag object `b662c5a4e84d49539981bb0faa589c3205178cf8`, package `1.24.1`).

## Must stay

- Unqualified `campfire capabilities --output json` keeps `kind: "cli_command_manifest"`, `version` 1, `manifestVersion` 1, and the playbook-off command order in `cli/command-names-playbook-off.txt` (59 names). Playbook-on inserts `playbook` only, at index 20, between `capabilities` and `bridge`.
- The only additive change allowed on that manifest is variant text on the existing `capabilities` entry. No existing command entry or field may lose or change meaning. Search and recipe results are separate projections (`capability_search`, `read_recipe`).
- New MCP tools are only `discover_capabilities` and `get_read_recipe`. Playbook-off `tools/list` is 38 tools. `get_playbook` appears only when the existing gate is on (39). Names, descriptions' security meaning, and input schemas otherwise stay as captured.
- No new `/v1/call` method. The Viewer read allowlist is unchanged. No database migration. No new domain object.
- Direct-call output, existing `--output` behavior, telemetry activation boundaries, and the opt-in playbook gate stay as they are. Discovery reads do not count as workspace activation.
- Published v1.24.1 installers are not edited by this step.

## Error envelope

New search and recipe failures use the existing code `ValidationError`, not a new string `VALIDATION_ERROR`. CLI: `{error:{code:"ValidationError",message,details?}}` on stderr, exit 1. MCP `fail()`: `{error:"ValidationError",message,details}` with `isError: true`. `details.field` is `query`, `limit`, or `id`.

An MCP SDK input-schema rejection is a different shape (`MCP error -32602` text). That is not the CAP-001 envelope. See `mcp/validation.json`.

## Catalog parity, not symmetry

`proposed/catalog.json` is the compact set the frozen queries use. Implementation must still map every discoverable CLI command and every registered MCP tool to exactly one operation or an explicit omission reason. CLI-only and MCP-only surfaces stay `unavailable`. Do not add a generic dispatcher to force symmetry. The operator bridge does not become an MCP tool.
