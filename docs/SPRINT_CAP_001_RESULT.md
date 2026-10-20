# Campfire — Sprint CAP-001 Result: Discover and Compose

**Date:** October 20, 2026

**Status:** **CONDITIONAL GO — engineering candidate.** D1–D7 pass on the local checks recorded below. Codex and OpenCode remain **NOT OBSERVED**. The human comparison is **NOT OBSERVED**. Package version stays `1.24.1`. This result does not bump a version, tag, publish a snapshot, pin an installer, or deploy. No release decision is recorded.

**Contract:** `docs/Campfire-v1.25-CAP-001-Discover-and-Compose.md`
**Step 0:** `1b212fe60e519bc344c91400ee7f5c2f297c3be0` (`docs/evidence/cap-001/step-0/`)
**Implementation revision:** `PENDING_SHA`
**Baseline:** published `v1.24.1`, package `1.24.1`. Private tag object `b662c5a4` → `a013d4f`.

## 0. Verdict and what it does not claim

Contract §7: **CONDITIONAL GO — engineering candidate** applies when D1–D7 pass and a real harness path is unavailable for a recorded reason. Both supported harness paths are unavailable.

- **Recorded reason:** this closeout did not launch Codex or OpenCode. The continuation proof is `tests/unit/cap-001-continuation.test.ts`, an engineering fixture over `fixtures/cap-001/seed.ts`. It is not a harness transcript and not a human observation.
- The optional non-builder human comparison was not run. That absence is **NOT OBSERVED**. It does not change the engineering verdict.
- This record does not claim a cross-harness improvement, Gate B, Gate C, Gate E, Gate F, or a rescore of NAV-001, NAV-002, NAV-003, or earlier sprints.
- Publishing `v1.25.0` needs a separate founder release decision.

## 1. What landed

Shared static catalog in `src/catalog/capability-search.ts`. The gate-off corpus is the frozen `operations` array from `docs/evidence/cap-001/step-0/proposed/catalog.json`. `CAMPFIRE_PLAYBOOK=1` / MCP `playbookEnabled === true` adds `get_playbook` and otherwise that definition is absent. CLI `campfire capabilities --search` and `--recipe` and MCP `discover_capabilities` and `get_read_recipe` call the same functions. Unqualified `campfire capabilities` still returns `cli_command_manifest`. The two new tools are registered outside the playbook gate and outside `ACTIVATION_METHODS` and `ACTIVITY_METHODS`. Search and recipe fetch do not open a store. No `/v1/call` method, Viewer allowlist entry, migration, domain object, or code runner was added.

`fixtures/cap-001/seed.ts` exports `seedCap001Database`. Fixture ids are unchanged. The CLI seed path still runs only when the file is the process entry.

## 2. Checks actually run

macOS, this worktree, package `1.24.1`.

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npx vitest run tests/unit/cap-001-search.test.ts tests/unit/cap-001-continuation.test.ts` | **36 passed** (search 34, continuation 2) |
| Focused related files (`cli-001`, `wco-001`, `att-001`, `wow-001-mcp`) | pass in the full suite below |
| `npm test` | **102 files, 1292 passed, 1 skipped** (1293) |
| `npm run build` | pass |
| `npm run deploy:dry-run` | pass. Wrangler 4.149.0 stopped at `--dry-run: exiting now`. No remote deploy |
| `npm run pack:tarball` in `/tmp/cap-001-pack` | pass. Darwin ARM64 archive SHA-256 `d7857cbdfc9154ccc3e1d27767caefa912d1cf751787148580784ae94e198f62`. Package metadata `1.24.1`. The main-repo `release/` archive was not overwritten |

The isolated pack used an rsync of `node_modules`. A first attempt with `node_modules` as a symlink failed `npm ls --omit=dev` before the installer guard. The immutable installer comparison then passed against `public/campfire/v1.24.1/install.sh` inside that copy. `scripts/package.sh` and `public/campfire/v1.22.0/install.sh` were not edited. `npm run export:public` was not run in this closeout.

The one skip is the existing opt-in Playwright test in `tests/unit/uix-001-dashboard-pty.test.ts`.

| Check | Result |
| --- | --- |
| **D1** | PASS. Unqualified `capabilities --output json` stays `kind: cli_command_manifest`. The `capabilities` entry keeps name, description, usage, mutates, workspaceScoped, outputModes, and protocol, and adds `--search` and `--recipe` variants only. Playbook-off corpus omits `get_playbook` and the words `incident-investigation`. `get_workspace_context` schema is unchanged. Tool inventory is the previous set plus `discover_capabilities` and `get_read_recipe` (length 40 playbook-off; `get_playbook` only when the gate is on). |
| **D2** | PASS for the frozen `queries.json` cases and live `tools/list` parity. Every discoverable CLI command is referenced by an operation usage or listed in `CAPABILITY_OMISSIONS`. Every live tool name is an `mcp.tool` on the active corpus or omitted. Corpus command words and tool names resolve. `bridge` MCP and `get_record_history` CLI stay unavailable with the frozen strings. CLI JSON and MCP JSON match for the same query and recipe id. |
| **D3** | PASS on the frozen query cases: controls before trim, query before limit, token AND, ascending ids, recipe summaries from id and goal only (max 2, frozen order), returned / totalMatches / truncated, and the 16 KiB budget. The largest frozen projection is within 16384 bytes. Search JSON for those queries contains none of the answer-key fixture ids. Queries are not evaluated as regular expressions. |
| **D4** | PASS on the engineering fixture and the static catalog. Discovery and recipe fetch take no store. A denied actor (`hum_cap001_zed`) cannot read `ws_cap001_lab`. Omission text says listing a command or tool is not a grant. Search does not read `outputCaveat`, preconditions, input names, or unavailable text (`whoami` does not match `workspace`; `get_record_history` does not match `workspace` through an input name). |
| **D5** | PASS. Both frozen recipes parse equal from `getReadRecipe` and from CLI/MCP JSON. Each `JSON.stringify` is under 8192 bytes. Unknown id throws `ValidationError` field `id`, message `Unknown read recipe id.` The continuation walk shows `task_cap001_blocked_later` on page 2 only, status `blocked`, assignee absent, first page truncated, and `dec_cap001_selected` accepted with `needsReview` only because `find_cap001_stale` is non-current. `find_cap001_current` stays current. `needsReview` is not treated as revocation or permission. |
| **D6** | PASS for the engineering fixture only. Codex is **NOT OBSERVED**. OpenCode is **NOT OBSERVED**. No harness time, call count, or output-byte comparison against the v1.24.1 path is claimed. |
| **D7** | PASS for typecheck, the full suite, build, isolated `pack:tarball`, and `deploy:dry-run`. The installer guard did not reject the unbumped tree. Public export was not re-run. Version stays `1.24.1`. No channel promotion. |

## 3. Deviations

- The searchable corpus is the frozen 16 operations, plus `get_playbook` only when the gate is on. Other installed commands and tools stay installed and are listed in `CAPABILITY_OMISSIONS`. Listing them is not a grant.
- Step 0 said exactly one operation per command. `inspect` is one command with selectors for `get_task`, `get_decision`, `get_finding`, and `get_artifact`. A command is covered when any operation usage starts with `campfire <name>`.
- Those four frozen `inspect` usages stay selector-specific. They differ from `commandSpec("inspect").usage`. Pointing them at the generic usage would overstate each operation. Other frozen usages with a command word match `commandSpec`. The capabilities MCP unavailable string stays `CLI manifest only; tools/list is the MCP inventory until discover_capabilities exists`.
- Validation failures use code `ValidationError`. The contract's word `VALIDATION_ERROR` means that existing code string.
- Page 2 of the fixture returns one task, `truncated: true`, and no `nextCursor`. The seed and the frozen answer key already record that shape.
- The gate-on query `recorded` matches `get_decision` only. The playbook purpose contains `recording`, and `recording` does not contain the substring `recorded`. Gate-on `recording` matches `get_playbook`. `queries.json` was not edited.
- `answer-key.json` includes a `handoff` rubric (`mustSay` / `mustNotSay`). `seedCap001Database` does not return that object. The continuation test compares the key with `handoff` removed. The frozen JSON was not edited.

## 4. Release boundary

No release decision. No tag, push, or production deploy. The `/tmp` tarball is a packaging check, not a published archive.
