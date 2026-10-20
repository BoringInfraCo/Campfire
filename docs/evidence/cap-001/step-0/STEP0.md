# CAP-001 Step 0 — v1.24.1 baseline, fixture answer key, and discovery contract

**Date:** 2026-10-20  
**Status:** Freeze before product code. This is not `docs/SPRINT_CAP_001_RESULT.md` and it is not a verdict.  
**Label: FIXTURE EVIDENCE — engineering evidence only.** No human usefulness trace was run. Codex and OpenCode discovery sessions are **NOT OBSERVED**.

Contract: `docs/Campfire-v1.25-CAP-001-Discover-and-Compose.md` §§0–5 and §6 D1–D3. This packet freezes the baseline those checks will compare. It does not implement search or recipes.

## 1. Released baseline

| Fact | Value |
| --- | --- |
| Checkout HEAD | `05fb273557c11ce515f8c4b0c37411831a75374f` |
| Annotated tag object | `v1.24.1` → `b662c5a4e84d49539981bb0faa589c3205178cf8` |
| Tag resolves to | `a013d4f1055f56686f5cb9fc3e67e87a41a99364` |
| `git diff a013d4f -- src package.json` | empty |
| Package on this checkout | `1.24.1` |
| What was captured | This checkout's CLI and MCP, because `src/` matches that release commit. Later docs commits are not product source. |

`CAMPFIRE_TELEMETRY=0` on every `campfire` invocation. `CAMPFIRE_PLAYBOOK`, `CAMPFIRE_URL`, `CAMPFIRE_TOKEN`, and `CAMPFIRE_DB` were unset except where playbook-on set `CAMPFIRE_PLAYBOOK=1`. The manifest scan found no home path, no `cft_` credential, and no username. The word `token` appears only in public usage text. No masking edit was required. Digests are the exact stdout or stderr bytes, including the trailing newline from `console.log` / `console.error`.

### Reproduce

```sh
cd <repo>
git diff --exit-code a013d4f1055f56686f5cb9fc3e67e87a41a99364 -- src package.json
env -u CAMPFIRE_PLAYBOOK -u CAMPFIRE_URL -u CAMPFIRE_TOKEN -u CAMPFIRE_DB \
  CAMPFIRE_TELEMETRY=0 ./node_modules/.bin/tsx src/cli/index.ts capabilities --output json
env -u CAMPFIRE_URL -u CAMPFIRE_TOKEN -u CAMPFIRE_DB \
  CAMPFIRE_TELEMETRY=0 CAMPFIRE_PLAYBOOK=1 ./node_modules/.bin/tsx src/cli/index.ts capabilities --output json
env -u CAMPFIRE_PLAYBOOK -u CAMPFIRE_URL -u CAMPFIRE_TOKEN -u CAMPFIRE_DB \
  CAMPFIRE_TELEMETRY=0 ./node_modules/.bin/tsx src/cli/index.ts catch-up --output json
env -u CAMPFIRE_PLAYBOOK -u CAMPFIRE_URL -u CAMPFIRE_TOKEN -u CAMPFIRE_DB \
  CAMPFIRE_TELEMETRY=0 ./node_modules/.bin/tsx src/cli/index.ts catch-up --output human
CAMPFIRE_TELEMETRY=0 npx tsx fixtures/cap-001/seed.ts --out fixtures/cap-001/.tmp/served --force
```

MCP `tools/list` used `@modelcontextprotocol/sdk` `Client`, `InMemoryTransport`, and `createCampfireMcpServer`, the same pair as `tests/integration/mcp.test.ts`. The script lived under `/tmp` and was not committed. Playbook-off omits `playbookEnabled`. Playbook-on sets it true.

## 2. CLI manifest

| File | sha256 | Commands |
| --- | --- | --- |
| `cli/capabilities-playbook-off.json` | `f1b00565d2c34b12204c087074fa00fa62051adc5d47e3da3975af6c64a27cd9` | 59 |
| `cli/capabilities-playbook-on.json` | `aaebcb1e86baefbe5ab3991ebf339afcaa2a52f16417f5c9795ce32777f9cd9e` | 60 |

Both are `kind` `cli_command_manifest`, `version` 1, `manifestVersion` 1, `campfireVersion` `1.24.1`. Playbook-on inserts `playbook` at index 20, after `capabilities` and before `bridge`. It does not append. Order is `cli/command-names-playbook-off.txt` and `cli/command-names-playbook-on.txt`.

`campfire create-workspace --output human` does not reach the missing-flag error. That command is JSON-only, so human mode returns a different `ValidationError` ("prints JSON only"). The pinned missing-argument case is `campfire catch-up` with no `--after`. Exit 1. Stdout empty.

Human stderr (`6fa7981ce522c7d93b5cd510e5ac0610979a69a250d96b9bd980bdf5b9c226d0`):

```text
[ValidationError] Missing required --after argument
Next:
  campfire catch-up --help
```

JSON stderr (`a4f9d1fe9061cf455ffd27848c979388a455e49473b3f253eca4fbf31fad70b8`):

```json
{"error":{"code":"ValidationError","message":"Missing required --after argument","details":{"field":"after"}},"next":[{"command":"campfire catch-up --help","when":"See required arguments for this command"}]}
```

A non-TTY `auto` mode uses the JSON envelope. Human text requires `--output human`.

## 3. Error code decision

The contract's words "VALIDATION_ERROR" mean the existing code `ValidationError`. Do not add a new code string.

- CLI: `{error:{code:"ValidationError",message,details?}}` on stderr. `formatCliFailure` in `src/cli/recovery.ts`.
- MCP `fail()` in `src/mcp/tools.ts`: `{error,message,details}` text, `isError: true`. A `CampfireError` passes `error.code` through, so the value is `ValidationError`, not a different name. `details` is null when the helper is called without details.

In-memory `get_record_history` with `objectId: ""` for a participant returned:

```json
{"error":"ValidationError","message":"Missing required objectId","details":{"field":"objectId"}}
```

`isError` true. That field is `objectId` because this is today's helper, not a search error. CAP-001 search and recipe errors must keep this envelope and use `details.field` of `query`, `limit`, or `id` only.

`list_tasks` with no arguments did not reach `fail()`. The SDK returned `isError` true and the text `MCP error -32602: Input validation error: Invalid arguments for tool list_tasks: Invalid input: expected string, received undefined at workspaceId`. That shape is not the CAP-001 envelope. See `mcp/validation.json`.

## 4. MCP tools/list

| File | sha256 | Count |
| --- | --- | --- |
| `mcp/tools-playbook-off.json` | `a93506ddde68dccaec0909de77d33aae060eca2a61d94be822c1a5c522425601` | 38 |
| `mcp/tools-playbook-on.json` | `6de8aee4dab871567caa2ef56f1fe591024712ea149979783fb1d19847527b65` | 39 |

`get_playbook` is the only name added when the gate is on. Each saved tool has `name`, `description`, `inputSchemaKeys`, `required`, and the public `inputSchema`. `tests/integration/mcp.test.ts` `EXPECTED_TOOLS` is an `arrayContaining` subset, not this count.

## 5. Fixture

`fixtures/cap-001/seed.ts` asserts the answer key, including cursors and contribution ids. `ANSWER_KEY.md` is the prose. `answer-key.json` sha256 `44f5936ab614b244144578f3d2d2028547946801be4f75861bde6e5d7e910f12`.

The blocked task past the first page is `task_cap001_blocked_later`. Page 2 has `truncated: true` and no `nextCursor` because returned (1) is less than total (21). That is the live `toContextSlice` rule. A handoff must not call the first page complete and must not invent another page when `nextCursor` is absent.

`needsReview` on `dec_cap001_selected` is true because the cited finding `find_cap001_stale` is superseded. The decision status stays `accepted`. The current finding is also cited and is the only finding in the orientation slice.

## 6. Harness

`HARNESS_BASELINE.md`. Both binaries resolve. Both paths are **NOT OBSERVED**. No tool trace was invented.

## 7. Proposed contract

`proposed/search-schema.md`, `aliases.json`, `catalog.json`, `continue-blocked-work.json`, `review-decision-basis.json`, `queries.json`, and `compatibility.md`.

Recipe files are 5592 and 4130 bytes, both under 8 KiB. `inputsFrom` is `client selection` or a prior field name. No fixture id is in the recipes. `get_record_history` CLI surface is `unavailable`. Query cases for orientation, blocked work, decision basis, history, an unknown operation, empty, overlong, a hostile regex-like string, default and max limits, and zero matches are in `queries.json`.

## 8. What this freeze does not claim

- Unqualified capabilities JSON stays `cli_command_manifest`. Only additive variant text on the `capabilities` entry is allowed later. New MCP tools are only `discover_capabilities` and `get_read_recipe`. No `/v1/call` method, no Viewer allowlist change, no migration.
- `campfire decisions` sends limit 100 when `--limit` is omitted. MCP `list_decisions` without `limit` uses the service default 10. The recipe states that. See `paired-operations.md`.
- `list_workspaces` returns an array, not a cursor page. The continue recipe does not invent a cursor for it.
- The compact catalog is not every CLI command. `catalog.json` `parityRule` requires a later map of every discoverable command and registered tool, or an explicit omission.
- No product search code, version bump, tag, or installer edit is in this step.
