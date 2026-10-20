# Campfire v1.25 — CAP-001: Discover and Compose

**Date:** October 20, 2026  
**Status:** Proposed sprint contract. Freeze Step 0 and this acceptance contract before product code; no implementation or release decision is recorded here.  
**Baseline:** Published and deployed `v1.24.1`, package `1.24.1`. Private annotated tag object `b662c5a4e84d49539981bb0faa589c3205178cf8` resolves to release source `a013d4f1055f56686f5cb9fc3e67e87a41a99364`. See `docs/RELEASE_V1_24_1_DECISION.md`.  
**Direction:** `docs/ROADMAP.md`, post-v1.24.1 two-cycle capability sequence; `docs/ARCHITECTURE.md` §§3, 13, 19–20, 24.  
**Release shape:** Candidate minor `v1.25.0`. A separate recorded founder decision is required before version bump, tag, public snapshot, channel pin, or deployment.

## 0. Sprint question and earned claim

> Can an agent in either supported harness find the appropriate Campfire operation, then follow a short, bounded sequence of existing authorized reads to identify a task's evidence and leave a source-cited handoff, without a pasted tool inventory or a Campfire code runner?

CAP-001 pairs the two **Priority next** roadmap capabilities in one sprint: discoverable workspace capabilities and composable read recipes. The product claim is narrower than general tool execution. Campfire describes installed interface operations and retrieval paths. The client chooses and calls each operation. Core still authorizes every workspace read and write. A catalog entry, recipe step, CLI command, or MCP tool listing grants no authority.

The engineering result must show fewer failed or irrelevant discovery calls than the frozen v1.24.1 path on the same tasks, while preserving the exact source IDs and coverage. Any human usefulness observation is reported separately; fixture or builder traces do not become team adoption evidence.

## 1. Released baseline and Step 0 freeze

The current `campfire capabilities --output json` returns a version-1 `cli_command_manifest` generated from `src/cli/catalog.ts`. It lists installed CLI commands, effects, output modes, and usage. MCP tools are registered separately in `src/mcp/tools.ts`; MCP `tools/list` exposes their names, descriptions, and input schemas. `get_playbook` is opt-in and remains the single WOW-001 recording playbook. The CLI manifest and MCP list describe interfaces, not the acting actor's grants. The existing `whoami`, `list_workspaces`, `preflight`, and workspace methods provide identity, membership, readiness, and authorized data on their own paths.

Before implementation, commit `docs/evidence/cap-001/step-0/` containing:

1. The released-tag CLI manifest and MCP `tools/list` names/schemas with a stable digest, including the playbook-off default and playbook-on comparison. Mask paths, tokens, local usernames, and endpoint secrets.
2. A field map for representative paired operations (`context` ↔ `get_workspace_context`, `tasks` ↔ `list_tasks`, `decisions` ↔ `list_decisions`, `inspect task` ↔ `get_task`) and explicit CLI-only/MCP-only cases. Do not assert a false one-to-one mapping for every command.
3. A frozen authorized workspace fixture with at least one blocked task beyond a first bounded page, a cited current and non-current finding, a selected decision, record history, a second workspace, and a denied actor. Record exact IDs, cursors/coverage, and expected answer key before code.
4. Released v1.24.1 Codex and OpenCode discovery/continuation transcripts or labeled unavailable paths, using identical tasks and a clean context. Record tool calls, failed calls, elapsed time to correct source, output bytes, and wrong inferences; private conversation text stays out of committed evidence.
5. The proposed catalog entry fields, search queries, two recipe definitions, default and maximum result limits, error shapes, and compatibility snapshots. Freeze any change to this contract before writing product code.

Step 0 evidence is a reproducible baseline, not a human-use result. If the released tag cannot run on the fixture, record the exact break and repair the fixture or amend the contract openly before scoring the candidate.

## 2. Interface and discovery contract

Keep the existing unqualified `campfire capabilities [--output auto|human|json]` behavior and its version-1 JSON envelope, command order, `kind: "cli_command_manifest"`, and default playbook gate unchanged. Its `capabilities` command entry may gain additive variant descriptions for the two new selectors; no existing command entry or field may lose or change meaning. Add an explicit search variant, `campfire capabilities --search <query> [--limit <1..10>] [--output auto|human|json]`. MCP adds one read-only, local-catalog tool, `discover_capabilities({query, limit?})`. Both render the same versioned **search projection** from shared semantic metadata; this is not a new `/v1/call` method, database query, or workspace object.

The projection names `kind: "capability_search"`, `catalogVersion: 1`, the query, `returned`, `totalMatches`, `truncated`, ordered `entries`, and `recipeSummaries` (matching ID and one-line purpose for either of the two §3 recipes when relevant to the query). Each operation entry has a stable logical ID, short purpose, effect (`read`, `write`, or `local-operation`), scope (`installed`, `workspace`, or `instance`), required input names/types, output/coverage caveat, agent-session precondition if relevant, and explicit `cli` and/or `mcp` invocations. An interface absent on one surface is marked absent, never fabricated. The existing CLI manifest remains a CLI manifest; the search projection is an additive, separate contract.

Freeze these JSON field names and meanings in Step 0: `entries[] = {id, purpose, effect, scope, requiredInputs:[{name,type}], preconditions:[], outputCaveat, surfaces:{cli,mcp}}`. Each surface is either `{usage}` for CLI or `{tool}` for MCP, or `{unavailable: <short reason>}`; it never contains a live argument value. `recipeSummaries[] = {id,purpose}`. `returned` is `entries.length`, `totalMatches` counts all matching operation entries before limits, and `truncated` is true whenever matching operation entries are withheld. `catalogVersion` changes only for an incompatible projection change. Errors use the existing CLI/MCP error envelope with a stable `VALIDATION_ERROR` code and a bounded `field` value of `query`, `limit`, or `id`; Step 0 pins the current envelope before implementation.

Search is deterministic over names, descriptions, recipe summaries, and a small frozen alias set. Normalize case and whitespace, cap a query at 120 characters, default to 8 operation entries and cap at 10, and use stable operation ID order to break ties. `returned` and `totalMatches` count operation entries; `recipeSummaries` has its own maximum of two. Empty, malformed, or overlong queries return a bounded validation error; a query matching neither operations nor recipes returns both arrays empty with `totalMatches: 0`. The JSON projection is at most 16 KiB: bound each field's length in the frozen schema, then omit whole entries at the limit and report `truncated`; never cut a JSON value or a required caveat. Never evaluate a user regex, model-generated program, shell command, remote index, or external URL. Freeze the exact query/result answer key in Step 0. A search result identifies candidate operations, not a verified plan or an authorization result.

The catalog describes **installed interface capability**, not a new Capability domain object or a grant. `available` must not mean `authorized now`. Search may run before workspace selection and expose no workspace names, IDs, row counts, membership verdict, private schema data, token, secret, environment variable value, or one-time credential receipt. It may state that an operation requires authentication, a workspace, a registered agent session, or a separate operator credential. Use existing `whoami`, `list_workspaces`, and `preflight` where applicable for readiness, and let the invoked method enforce authorization. A denied actor may see public method documentation but gains no workspace data or authorization oracle from search. The operator-only bridge remains CLI-only and does not become an agent MCP tool.

One shared semantic metadata source must drive the two search adapters; parity tests must also compare its invocation mappings with the existing CLI catalog and MCP registrations. Preserve the registered MCP names, descriptions' security meaning, input schemas, and existing tool count apart from `discover_capabilities` and the recipe read in §3. The unqualified CLI manifest keeps its envelope and existing command semantics, with only the explicit additive `capabilities` variants allowed. Do not silently change direct-call output, CLI option parsing beyond these explicit variants, `--output` behavior, telemetry activation boundaries, or the Viewer read allowlist. An opt-in command such as `playbook` appears only under its existing gate and does not leak a disabled definition.

## 3. Static read-recipe contract

Add `campfire capabilities --recipe <id> [--output auto|human|json]` and one MCP read-only local-catalog tool, `get_read_recipe({id})`. They return the same `kind: "read_recipe"`, `recipeVersion: 1`, stable ID, goal, ordered **read** steps, mapped CLI/MCP invocation for each step, required input source, page/stop rule, completeness caveat, and expected source-cited result. Each JSON recipe is at most 8 KiB. Exact unknown IDs fail with a bounded validation error. Search returns matching recipe IDs and summaries in `recipeSummaries`; obtaining the full recipe is explicit. No recipe is stored in a workspace, runs on the server, records a Contribution, or accepts user-supplied code.

Freeze the recipe JSON as `{kind, recipeVersion, id, goal, steps, resultContract}`. Each ordered step is `{operationId, inputsFrom, surfaces, stopWhen, coverageCaveat}`; `surfaces` uses the same explicit available/unavailable shape as search. `inputsFrom` names a prior result field or `client selection`, never a fixture value. `resultContract` names the IDs, provenance/currentness, coverage, and unresolved gaps that a handoff must carry. Neither projection embeds a workspace record or precomputes a handoff.

Freeze exactly two recipes:

| Recipe ID | Existing read path and required stop behavior |
| --- | --- |
| `continue-blocked-work` | `list_workspaces` → select an authorized workspace → `get_workspace_context` → page `list_tasks` only if orientation is incomplete or the named task is absent → `get_task` for the selected task → inspect only recorded cited decision/finding/artifact IDs with existing get-by-ID reads → `get_record_history` when the change sequence matters. A handoff names the selected record IDs, state, provenance, coverage, and unresolved evidence. It does not change Task status or infer that an assignee is live. |
| `review-decision-basis` | `get_workspace_context` or bounded `list_decisions` → `get_decision` → read only its recorded basis and cited findings with existing get-by-ID methods → `get_record_history` if replacement/currentness is unclear. Report proposed versus accepted versus accepted-needing-review accurately; a recipe never treats a review cue as revocation or permission to act. |

Each recipe is a sequence of references to existing methods, not a new service transaction. The client supplies IDs and cursors from prior authorized results. The `get_record_history` step is currently MCP-only; its CLI mapping must say `unavailable`, and a CLI client stops with a labeled history gap when record-level chronology is necessary. `campfire activity` is workspace-wide and is not a substitute for that targeted read. It must not fabricate IDs, skip a truncated page while claiming completeness, reuse a cursor for another actor/workspace, or fetch a full inspector as a hidden fallback. When a read is denied, stale, missing, or truncated, the recipe stops or labels the gap and offers the next bounded read. Do not place raw records, private prompts, generated summaries, executable scripts, approval instructions, or fixed fixture IDs in the catalog. These are navigation recipes, not a second playbook or a skills platform; WOW-001 remains opt-in and unchanged.

## 4. Boundary and compatibility rules

- **Service ownership:** CLI and MCP adapters describe/read a static installed catalog. Application services, not adapters or recipes, enforce workspace access. Local SQLite and hosted Worker/D1 use the same existing method semantics; discovery does not open either store.
- **Identity:** Human/agent distinction and acting principal remain bound by the existing clients. Search does not register a session. A write discovered in the catalog remains subject to its original role and session checks.
- **Payload safety:** Exclude tokens, invitation contents, session IDs, raw URLs with credentials, private transcript text, and stored workspace content from catalog and recipe projections. Treat labels and queries as untrusted text in terminal output. MCP error results retain structured errors and no unexpected stack trace.
- **Lifecycle:** A recipe's output is guidance for the current client; it is not durable workspace state, online presence, action authority, a decision, or proof a teammate used the result.
- **Compatibility:** Preserve `cli_command_manifest` version 1, existing CLI JSON and stdout/stderr behavior apart from additive `capabilities` variant descriptions, all existing MCP tool names/schemas, HTTP `/v1/call` contracts, Viewer allowlist, published installer copies, and opt-in playbook behavior. No database migration, new domain object, remote execution host, or arbitrary `execute` endpoint.

If a needed operation cannot be expressed as a truthful mapping without exposing data or changing its authorization semantics, leave that mapping absent and record the limitation. Do not create a generic dispatcher to satisfy catalog symmetry.

## 5. Implementation sequence

| Step | Work | Exit |
| --- | --- | --- |
| **0 — freeze** | Record §1 baseline, fixture answer key, queries, recipes, result/error shapes, budgets, paired-operation matrix, and threat/compatibility checklist. | Another engineer can reproduce the v1.24.1 path and tell what CAP-001 must improve before product code. |
| **1 — catalog** | Build the smallest shared semantic metadata/projection and parity locks over CLI catalog and MCP registrations. Add additive CLI search and MCP `discover_capabilities`; retain old manifest. | Same query returns semantically identical ordered entries on both surfaces; disabled or unsupported interfaces stay absent. |
| **2 — recipes** | Add the two static recipe definitions and CLI/MCP retrieval adapters. | Both surfaces return identical versioned steps and truthful stop/coverage rules; no workspace access or execution occurs while fetching a recipe. |
| **3 — continuation proof** | Run both recipes through existing authorized calls on the frozen workspace from Codex and OpenCode when available. Compare with released baseline. | Correct IDs and incomplete-state caveats survive; no unauthorized read, hidden write, or full-workspace shortcut appears. |
| **4 — review and record** | Run D1–D7, focused tests, full suite, typecheck, build, tarball/public-export audit, and deploy dry run. Independently inspect catalog drift, credential leakage, false grants, and recipe claims. | `docs/SPRINT_CAP_001_RESULT.md` records exact revision, evidence, deviations, engineering verdict, distinct harness/human observations, and no implicit release decision. |

## 6. Deterministic acceptance checks

| Check | Required evidence |
| --- | --- |
| **D1 — released contract preservation** | On v1.24.1 and candidate, unqualified `capabilities --output json` retains the frozen `cli_command_manifest` envelope, command order/output modes, and playbook gating. Only additive variant descriptions on the `capabilities` entry and the installed package version after a separately approved bump may differ; all prior entry fields retain their meaning. New search/recipe variants have separate projections. Existing CLI direct outputs, MCP names/schemas, HTTP methods, Viewer allowlist, and session instructions remain compatible; the two explicitly added MCP discovery tools are the only tool-list additions. |
| **D2 — catalog parity** | Frozen query cases for orientation, blocked work, decision basis, history, and an unknown operation yield identical logical IDs/effects/preconditions/invocations and matching recipe summaries through CLI search and MCP discovery. Paired operations match actual CLI dispatch and MCP registration. CLI-only/MCP-only and disabled entries are labeled or omitted truthfully. A catalogued entry never points to a missing handler. |
| **D3 — bounded deterministic search** | Default/maximum limits, tie order, query normalization, empty/overlong/hostile input, zero matches, and result byte budget pass. No search result contains workspace facts, secret values, credential receipts, environment values, or unrestricted data; query text cannot become terminal controls, a regex, or executable code. |
| **D4 — authority separation** | A member, viewer, registered agent, unregistered agent, non-participant, and wrong-workspace caller see no workspace data through discovery or recipe fetch. Static descriptions never assert a grant. Existing direct-call authorization and agent-session requirements continue to deny or allow exactly as before, including remote and local paths. |
| **D5 — recipe fidelity** | Both recipe IDs return equal parsed JSON from CLI and MCP aside from protocol framing/whitespace. Their only work steps name existing reads; each maps to valid parameters or an explicit unavailable surface and includes cursor/coverage/error stops. The CLI-only run stops and labels the record-history gap if that MCP-only step is necessary. Frozen blocked-task and needs-review cases produce exact source IDs and avoid false completeness, accepted-decision revocation, presence, or action-permission claims. |
| **D6 — cross-harness continuation** | Deterministic Codex/OpenCode-shaped fixtures complete the frozen tasks without a pasted tool list and produce correct source-cited handoffs with direct authorized calls. Separately run real Codex and OpenCode paths when available, recording harness identity, calls, failures, time to correct source, output bytes, and agent corrections against Step 0. A missing real path is labeled NOT OBSERVED and limits the verdict; scripted success is engineering evidence, not human understanding. |
| **D7 — distribution and regression** | Focused CLI/MCP/hosted-denial tests, full test suite, typecheck, build, source/public asset parity, `pack:tarball`, public-copy/export audit, and `deploy:dry-run` pass on the candidate. Run packaging against the candidate in an isolated checkout so generated archives cannot be mistaken for released artifacts; preserve the package's immutable-installer guard and the published v1.24.1 pin. If that guard rejects the unbumped candidate, record D7 as pending rather than waiving it; a separately approved v1.25.0 release-prep revision must pass the same check before an engineering GO or release recommendation. A version bump and channel promotion have their own release verification. |

A leaked workspace fact or secret, a false authorization claim, a catalog entry that invokes a different effect, a recipe that silently writes or overstates complete evidence, or an unbounded/unsafe execution path is **NO-GO / REFRAME**. Repair and rerun the affected check; do not weaken the assertion or convert a fixture trace into a human result.

## 7. Observation, verdict, and release boundary

Run two cold, read-only continuation tasks in the supported harnesses: identify the blocked task and its evidence, then explain the selected decision's current basis. Use the same prompts and seeded records as Step 0, with order and retries recorded. If two non-builder humans are available, separately observe whether the capability descriptions help them identify the right action and notice missing evidence. Their absence is **NOT OBSERVED**, not a failed engineering check or an invented release veto.

- **GO — bounded engineering and harness claim:** D1–D7 pass and both real harness paths finish the tasks with correct cited IDs, coverage, and no authorization or decision error. Report the measured change against baseline; claim speed/output improvement only if the numbers support it.
- **CONDITIONAL GO — engineering candidate:** D1–D7 pass, but one real harness path is unavailable for a recorded reason. Name that path **NOT OBSERVED** and do not claim a cross-harness improvement. A missing optional non-builder human comparison is reported separately and does not by itself alter the engineering verdict.
- **NO-GO / REFRAME:** A deterministic check fails, a real trace shows a source/authority error, or the catalog cannot truthfully describe the existing operations within the bounded interface.

This sprint does not rescore NAV-001/002/003 or Gates B/C/E/F. Publishing a candidate requires a separate founder release decision with accurate claims. No v1.26 proposal, approval, event-ingestion, or outcome-receipt work starts inside CAP-001.

## 8. Deliverables and stop boundary

1. Step 0 released-tag pin, CLI/MCP catalog snapshots, paired-operation matrix, fixture answer key, and baseline traces.
2. Additive, bounded capability search on CLI and MCP, backed by shared semantic metadata and parity locks; unqualified `campfire capabilities` stays compatible.
3. Exactly two static read recipes exposed identically through CLI and MCP, with no server execution or workspace data stored in them.
4. D1–D7 evidence, independent security/compatibility review, cross-harness comparison or explicit observation gap, and `docs/SPRINT_CAP_001_RESULT.md`.
5. A separate release decision before any `v1.25.0` bump, tag, public export, channel pin, or deployment.

Do not add action proposals, approvals, events, capability grants, external integrations, general skills/playbooks, arbitrary scripts, agent scheduling, generated summaries, organization-wide discovery, a new Viewer panel, or a code runner to complete this sprint.
