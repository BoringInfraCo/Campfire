# Campfire — Sprint CAP-001 Result: Discover and Compose

**Date:** October 20, 2026

**Status:** **CONDITIONAL GO — engineering candidate.** D1–D7 pass, including the export audit in §5. A targeted smoke in §6 asked each harness to use capability discovery and a read recipe without naming tools, commands, recipe ids, or fixture ids. Both did, and both named the required ids. The earlier unprompted smoke did not exercise discovery. Automatic adoption and improved continuation remain unproven. The human comparison remains **NOT OBSERVED**. Package version stays `1.24.1`. This result does not bump a version, tag, publish a snapshot, pin an installer, or deploy. No release decision is recorded. §5 and §6 supersede the original "both harnesses unavailable" sentence.

**Contract:** `docs/Campfire-v1.25-CAP-001-Discover-and-Compose.md`
**Step 0:** `1b212fe60e519bc344c91400ee7f5c2f297c3be0` (`docs/evidence/cap-001/step-0/`)
**Implementation revision:** `910736848c3be2635c606b8301a8a6fc9718903a`
**Baseline:** published `v1.24.1`, package `1.24.1`. Private tag object `b662c5a4` → `a013d4f`.

## 0. Verdict and what it does not claim

Contract §7 defines **CONDITIONAL GO — engineering candidate** as D1–D7 passing with a real harness path unavailable for a recorded reason. This record retains that verdict for a narrower reason supported by the later evidence: the contract's §0 improvement claim was not measured, so the GO bar is not met even though both targeted harness paths finished.

- **Recorded reason:** the unprompted smoke did not observe spontaneous discovery, and no v1.24.1 baseline comparison was run. The targeted §6 smoke later showed both harnesses can finish when asked to use discovery and a recipe. That is not evidence of automatic adoption, fewer failed discovery calls, or improved continuation. The contract has no fourth label; retaining CONDITIONAL GO is the conservative choice.
- The continuation fixture is `tests/unit/cap-001-continuation.test.ts`, an engineering fixture over `fixtures/cap-001/seed.ts`. It is not a harness transcript and not a human observation.
- The optional non-builder human comparison was not run. That absence is **NOT OBSERVED**. It does not change the engineering verdict.
- This record does not claim a cross-harness improvement, Gate B, Gate C, Gate E, Gate F, or a rescore of NAV-001, NAV-002, NAV-003, or earlier sprints.
- Publishing `v1.25.0` needs a separate founder release decision. §6 shows the selected discovery path can finish the fixture. It does not by itself record that decision.
- §5 and §6 record the later runs. They do not retroactively convert the unprompted stop into GO or establish the §0 improvement.

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
| `node scripts/export-public-release.mjs` from a detached worktree of `59e48e1` | pass. See §5. `docs/evidence/cap-001/candidate/EXPORT_AUDIT.md` |

The isolated pack used an rsync of `node_modules`. A first attempt with `node_modules` as a symlink failed `npm ls --omit=dev` before the installer guard. The immutable installer comparison then passed against `public/campfire/v1.24.1/install.sh` inside that copy. `scripts/package.sh` and `public/campfire/v1.22.0/install.sh` were not edited. The export audit was run later and is recorded in §5.

The one skip is the existing opt-in Playwright test in `tests/unit/uix-001-dashboard-pty.test.ts`.

| Check | Result |
| --- | --- |
| **D1** | PASS. Unqualified `capabilities --output json` stays `kind: cli_command_manifest`. The `capabilities` entry keeps name, description, usage, mutates, workspaceScoped, outputModes, and protocol, and adds `--search` and `--recipe` variants only. Playbook-off corpus omits `get_playbook` and the words `incident-investigation`. `get_workspace_context` schema is unchanged. Tool inventory is the previous set plus `discover_capabilities` and `get_read_recipe` (length 40 playbook-off; `get_playbook` only when the gate is on). |
| **D2** | PASS for the frozen `queries.json` cases and live `tools/list` parity. Every discoverable CLI command is referenced by an operation usage or listed in `CAPABILITY_OMISSIONS`. Every live tool name is an `mcp.tool` on the active corpus or omitted. Corpus command words and tool names resolve. `bridge` MCP and `get_record_history` CLI stay unavailable with the frozen strings. CLI JSON and MCP JSON match for the same query and recipe id. |
| **D3** | PASS on the frozen query cases: controls before trim, query before limit, token AND, ascending ids, recipe summaries from id and goal only (max 2, frozen order), returned / totalMatches / truncated, and the 16 KiB budget. The largest frozen projection is within 16384 bytes. Search JSON for those queries contains none of the answer-key fixture ids. Queries are not evaluated as regular expressions. |
| **D4** | PASS on the engineering fixture and the static catalog. Discovery and recipe fetch take no store. A denied actor (`hum_cap001_zed`) cannot read `ws_cap001_lab`. Omission text says listing a command or tool is not a grant. Search does not read `outputCaveat`, preconditions, input names, or unavailable text (`whoami` does not match `workspace`; `get_record_history` does not match `workspace` through an input name). |
| **D5** | PASS. Both frozen recipes parse equal from `getReadRecipe` and from CLI/MCP JSON. Each `JSON.stringify` is under 8192 bytes. Unknown id throws `ValidationError` field `id`, message `Unknown read recipe id.` The continuation walk shows `task_cap001_blocked_later` on page 2 only, status `blocked`, assignee absent, first page truncated, and `dec_cap001_selected` accepted with `needsReview` only because `find_cap001_stale` is non-current. `find_cap001_current` stays current. `needsReview` is not treated as revocation or permission. |
| **D6** | **FIXTURE PASS; LIVE TARGETED PASS; ADOPTION/IMPROVEMENT NOT OBSERVED.** The engineering fixture passes. The unprompted smoke in §5 is mixed: OpenCode named the required ids, Codex did not, and neither called the new discovery tools. The targeted smoke in §6 asked for discovery and a read recipe and both harnesses then finished with the required ids. No comparison against the v1.24.1 path is claimed. |
| **D7** | PASS for typecheck, the full suite, build, isolated `pack:tarball`, `deploy:dry-run`, Viewer asset parity, and the public-copy audit in §5. The installer guard did not reject the unbumped tree. Version stays `1.24.1`. No channel promotion. |

## 3. Deviations

- The searchable corpus is the frozen 16 operations, plus `get_playbook` only when the gate is on. Other installed commands and tools stay installed and are listed in `CAPABILITY_OMISSIONS`. Listing them is not a grant.
- Step 0 said exactly one operation per command. `inspect` is one command with selectors for `get_task`, `get_decision`, `get_finding`, and `get_artifact`. A command is covered when any operation usage starts with `campfire <name>`.
- Those four frozen `inspect` usages stay selector-specific. They differ from `commandSpec("inspect").usage`. Pointing them at the generic usage would overstate each operation. Other frozen usages with a command word match `commandSpec`. The capabilities MCP unavailable string was corrected to `CLI manifest only; MCP provides tools/list and discover_capabilities` under Step 0 Amendment 1.
- Step 0 Amendment 1 (`docs/evidence/cap-001/step-0/AMENDMENT-1.md`) copies the frozen JSON and schema files byte-for-byte to `fixtures/cap-001/contract/` so the public snapshot can run the CAP-001 tests without exporting `docs/evidence/`. A private parity test keeps the copies equal. No query case, entry id, recipe step, answer-key fact, cursor, or limit changed.
- Validation failures use code `ValidationError`. The contract's word `VALIDATION_ERROR` means that existing code string.
- Page 2 of the fixture returns one task, `truncated: true`, and no `nextCursor`. The seed and the frozen answer key already record that shape.
- The gate-on query `recorded` matches `get_decision` only. The playbook purpose contains `recording`, and `recording` does not contain the substring `recorded`. Gate-on `recording` matches `get_playbook`. `queries.json` was not edited.
- `answer-key.json` includes a `handoff` rubric (`mustSay` / `mustNotSay`). `seedCap001Database` does not return that object. The continuation test compares the key with `handoff` removed. The frozen JSON was not edited.

## 4. Release boundary

No release decision. No tag, push, or production deploy. The `/tmp` tarball and the `/tmp/cap-001-public-export` snapshot are local checks, not published artifacts.

## 5. Addendum — harness smoke and export audit

**Date:** October 20, 2026. Evidence: `docs/evidence/cap-001/candidate/HARNESS_SMOKE.md` and `docs/evidence/cap-001/candidate/EXPORT_AUDIT.md`. This addendum does not change the engineering verdict to GO and does not record a release decision. The human comparison remains **NOT OBSERVED**.

### Harness smoke

One cold read-only session per harness, same prompt, no pasted tool list, no fixture ids in the prompt. Each session used its own seeded copy of `fixtures/cap-001` through local `campfire mcp`. `CAMPFIRE_URL` was unset. Real `~/.codex` and OpenCode configs were not modified. `campfire up` was not run. Port 9414 stayed down. Preflight `tools/list` returned 40 tools, including `discover_capabilities` and `get_read_recipe`. Neither database gained a contribution.

| Harness | Model | Duration | Discovery tool | Result |
| --- | --- | --- | --- | --- |
| Codex CLI 0.163.0 | `gpt-6.1-sol` | 37.95 s | not called | **Incomplete.** `list_workspaces` and `get_workspace_context` only. It reported the task slice as 20 of 21, `truncated: true`, and refused to name the later task. It named `dec_cap001_selected` as accepted with `needsReview` true, and did not read `find_cap001_stale`. It did not treat `needsReview` as revocation. |
| OpenCode 2.1.1 | `opencode/big-pickle` | 36.35 s | harness tool search, not `discover_capabilities` | **Ids correct.** `task_cap001_blocked_later` is `blocked` and was absent from the truncated first page. `dec_cap001_selected` is accepted and needs review because `find_cap001_stale` is superseded. `find_cap001_current` stays current. No write. |

Neither session called `discover_capabilities`, `get_read_recipe`, or `campfire capabilities --search`. OpenCode found the connected Campfire tools through its own tool index, then paged `list_tasks` and read the decision and findings. That is a correct fixture answer. It is not evidence that the new catalog is what the agent used. Codex's stop was honest about truncation and still failed the blocked-task identification. The GO bar — both live harnesses finish with the correct cited ids — is not met. This is not an authorization or source-corruption failure, so it does not by itself move the engineering verdict to NO-GO.

### Export audit

`node scripts/export-public-release.mjs --ref 59e48e1455afbc6c894c3a692bf13dd393375da7 --output /tmp/cap-001-public-export` exited 0 from a detached worktree. Printed version `v1.24.1`, 349 files, forbidden-path and secret-content scan passed. `src/catalog/capability-search.ts` is in the snapshot. `docs/evidence` is not. The four served Viewer assets match `src/viewer/static/`. `fixtures/cap-001/` is included because `fixtures/` is an allowlisted prefix and that directory is not in the private-prefix list. The seed contains synthetic ids, not a credential. The snapshot was not published.

## 6. Addendum — targeted discovery smoke

**Date:** October 20, 2026. Evidence: `docs/evidence/cap-001/candidate/TARGETED_CODEX.md` and `docs/evidence/cap-001/candidate/TARGETED_OPENCODE.md`. This addendum does not change the engineering verdict to GO and does not record a release decision. The human comparison remains **NOT OBSERVED**. Spontaneous discovery and a continuation improvement over v1.24.1 remain unproven.

The prompt told each harness to use Campfire's capability discovery before reading workspace records, then to fetch the read recipe for continuing blocked work and the read recipe for reviewing a decision's basis, and to follow the tools those recipes name. It supplied no tool name, command line, recipe id, or fixture id. Each session used its own seeded copy of `fixtures/cap-001` through local `campfire mcp`. `CAMPFIRE_URL` and `CAMPFIRE_TOKEN` were unset. Real Codex and OpenCode configs were not modified. `campfire up` was not run. Port 9414 stayed down. Preflight `tools/list` returned 40 tools, including `discover_capabilities` and `get_read_recipe`. Neither database gained a contribution (55 before and after).

| Harness | Model | Duration | Discovery | Recipes | Result |
| --- | --- | --- | --- | --- | --- |
| Codex CLI 0.163.0 | `gpt-6.1-sol` | 36.20 s | `discover_capabilities` (one limit-12 validation error, then successful queries) | `continue-blocked-work`, `review-decision-basis` | **Pass.** Named `task_cap001_blocked_later` as blocked and off the truncated first page, and `dec_cap001_selected` as accepted with `needsReview` because `find_cap001_stale` is superseded while `find_cap001_current` stays current. No write. |
| OpenCode 2.1.1 | `opencode/big-pickle` | 84.45 s | `discover_capabilities` (one limit-20 validation error; `"read recipe"` returned no matches) | same two, via `get_read_recipe` | **Pass.** Same ids and currentness. No write. A harness tool-index search also ran; it did not replace the Campfire discovery calls. |

A supported release claim after this smoke, still requiring a separate founder decision, is: shared capability search and two read recipes shipped; automatic adoption and improved continuation remain unproven.

### Why the first Codex session stopped

The unprompted Codex session called only `list_workspaces` and `get_workspace_context`. It reported 20 of 21 tasks, `truncated: true`, and refused to invent the later task id. It named the decision and did not read `find_cap001_stale`.

The `get_workspace_context` tool description says each slice carries `total`, `returned`, and `truncated`, that a truncated source page can hide a matching cue, and to pass `orientationCursor` to `get_workspace_changes` to catch up. It does not say to call `list_tasks` when the task slice is truncated. `list_tasks` says to pass the returned cursor, but that session never called it. The server session instructions name `list_tasks` among drill-down reads. They do not state the truncated-task stop rule.

That stop rule is in `continue-blocked-work`: if `slices.tasks.truncated` is true, or the selected task id is absent from `slices.tasks.items`, continue to `list_tasks`. The first session never fetched the recipe, so it never received that sentence. In this targeted run both harnesses fetched it. The returned text told them to continue to `list_tasks`, and both did: first page, then the cursor page that contains `task_cap001_blocked_later`. Page 2 is `truncated: true` with no `nextCursor`; both treated that as the end.

Search does not list `get_read_recipe`. A query whose tokens include "read recipe" returned zero matches for both harnesses. Narrower queries (`blocked`, `blocked task`, `basis`, `decision basis review`) returned the operation entries and the recipe summaries. Each model then called `get_read_recipe` with the summary id. The selected path works. Finding the recipe tool from search text alone does not.

## 7. Addendum — release-prep corrections and versioned checks

**Date:** October 20, 2026. Release-prep correction commit `fd75753`; versioned release-prep checks at package `1.25.0`. This addendum does not change the engineering verdict, the bounded claim, or the human comparison. The separate founder release decision is `docs/RELEASE_V1_25_DECISION.md`.

### Corrections

- The public exporter includes `tests/`, not `docs/evidence/`. The new CAP-001 tests originally read the frozen Step 0 files from `docs/evidence/`, so the public snapshot would have failed at collection. Step 0 Amendment 1 copies the frozen JSON and schema byte-for-byte to `fixtures/cap-001/contract/`; the exported tests read those copies, and the private `tests/unit/cap-001-step0-parity.test.ts` fails if they drift.
- The frozen catalog and inline corpus now say `CLI manifest only; MCP provides tools/list and discover_capabilities` instead of the now-false `until discover_capabilities exists`. The unavailable text is not part of search matching, so no frozen query result changed.
- The result record no longer says both harness paths are unavailable, and the D6 row labels the fixture pass, targeted live pass, and unobserved adoption/improvement separately. `HARNESS_SMOKE.md` now records that its evidence file was committed later and labels the unprompted OpenCode run by its actual discovery gap.

### Verification

| Check | Result |
| --- | --- |
| `npx vitest run` on CAP-001 search, continuation, and Step 0 parity | **43 passed** |
| Public snapshot export at `fd75753` | 356 files; `docs/evidence` absent; `fixtures/cap-001/contract` present |
| CAP-001 tests in the exported snapshot | **36 passed** (2 files) |
| `npm run typecheck` | pass |
| `npm test` at package `1.25.0` | **103 files / 1,298 passed / 1 expected failure / 1 opt-in skip** (1,300). The only failure is the pre-recorded `tests/unit/install-channels.test.ts` assertion awaiting the four published `v1.25.0` archives. Not loosened |
| `npm run build` | pass; all four served Viewer assets match `src/viewer/static/` |
| `npm run deploy:dry-run` | pass; Wrangler 4.149.0 read 75 public assets and stopped at `--dry-run: exiting now` |
| `npm run pack:tarball` | pass; Darwin ARM64 archive SHA-256 `1ddab9f28ad6c97b6840ddb4f3fe1ff0e7a0bd1a47717d863d8115d5b0a7f9e3`; extracted package `1.25.0` |
| Installer immutability | `public/campfire/v1.25.0/install.sh` equals the current installer (`2256bccb…`); `v1.24.1` and older copies remain unchanged |
