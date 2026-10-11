# RCL-001 run lock — October 10, 2026

Scored runs have not started. This file freezes the harnesses, models, budgets, arm order, and seed process before any scored run. It does not record a score.

## Frozen settings

| Item | Value |
| --- | --- |
| Implementation commit | `b6fc55865244ef4fc82db2d46c42b633f4017ab0` (`feat(recall): add the v1.16 recall and handoff candidate`) |
| Control source | `bb3bb61d716f52bb36e5f1c6e6514ece71abc555` (parent of the implementation commit; `recall_workspace` is absent) |
| Treatment source | the implementation commit's `src/` (package `1.15.0`; `recall_workspace` is present) |
| Matched harness | Codex `0.150.1` at `/Users/sergio/.local/bin/codex` |
| Matched model | `gpt-5.6-sol` |
| Matched reasoning | `high` |
| Recipient harness | OpenCode `2.0.26` at `/Users/sergio/.opencode/bin/opencode` |
| Recipient model | `opencode/space-bunny-free#xhigh` |
| Pilot root | `~/.campfire-pilot/rcl-001` (outside the repository) |
| Seed | `npx tsx fixtures/recall/rcl-001/seed.ts` |
| Runner | `npx tsx fixtures/recall/rcl-001/run.ts` |
| Arm order | S1 control, then treatment, then recipient; S2 treatment, then control, then recipient; S3 control, then treatment, then recipient |
| Matched budget | 20 minutes or 40 tool calls, whichever comes first |
| Recipient budget | 10 minutes or 20 tool calls, whichever comes first |

`~/.codex/config.toml` names `gpt-6-sol`. A pre-run Codex exec with that id returned: the model is not supported when using Codex with a ChatGPT account. `codex debug models` on this account lists `gpt-5.6-sol` as a visible model and lists `high` as a supported reasoning effort. A later exec with `gpt-5.6-sol` replied READY.

OpenCode has no configured model. `openai/gpt-5.6-sol` and `opencode-go/deepseek-v4.1-flash` returned `provider.no-route`. The account's most recent sessions use `opencode/space-bunny-free` with variant `xhigh`. An exec of `opencode/space-bunny-free#xhigh` replied READY. That is the recipient model. No scored run used the unavailable ids.

An empty answer is an invalid attempt. The runner keeps that directory with an `-invalid` suffix and repeats the arm once. A second empty answer stops the pilot. A completed answer is not repeated.

## Seed process

`fixtures/recall/rcl-001/seed.ts` opens a new sqlite file outside the repository and runs the real service with a caller-chosen id source. Org `org_rcl001` and team `team_rcl001` are fixture scaffolding. Each scenario owner is `hum_rcl001_s1`, `hum_rcl001_s2`, or `hum_rcl001_s3`. Seeded agents use harness `fixture` and no model. Sessions use harness `fixture`.

`hum_rcl001_reader` is a viewer on each workspace, authors none of the keyed objects, and is the named packet recipient. That participant is seed scaffolding. It is not an edit to `ground-truth.md`. The correction reason stored by the service is `recorded correction`. The seed check rejects a packet that contains that reason.

The seed writes `campfire.db`, mode-0600 `tokens.json`, and an id-only `receipt.json` under the pilot root. It checks recall membership, lifecycle, provenance, citations, `needsReview`, and one handoff projection before it returns. Replacing an existing seed requires `--force`.

## Arm prompts

The runner reads `scenarios.md` and passes one string to the harness. It does not mount this directory.

Control addendum, after the task prompt:

> Use orientation, catch-up, and drill-down. Do not write or update Campfire records.

Treatment addendum, after the task prompt and `Recall query: <the scenario query>`:

> Use recall_workspace with that query before you answer. You may also use orientation, catch-up, and drill-down. Do not write or update Campfire records.

Recipient addendum, after the continuation paragraph:

> The offline packet is the file packet.json in this directory. Do not use a Campfire credential or a live workspace.

The packet is produced by `campfire handoff-packet` from a copy of the seed database before the recipient starts. The issuer is the scenario owner. The recipient actor is `hum_rcl001_reader`. The recipient process receives the file and no Campfire token, database, or URL.

## Isolation

Each arm runs under `sandbox-exec`. The profile denies reads of `fixtures/`, `docs/`, `evidence/`, the seed directory, other arms' run directories, the operator Campfire profile, the user OpenCode config and state, and the user Codex config, memories, sessions, skills, and rules. The harness home is a fresh directory with only the auth file copied in. `CAMPFIRE_URL`, `CAMPFIRE_TOKEN`, `CAMPFIRE_DB`, and `CAMPFIRE_ACTOR_ID` are unset in the harness process. The matched arm's token and database are visible only to that arm's Codex MCP server configuration.

Control MCP is `src/mcp/stdio.ts` from the control commit. Treatment MCP is `src/mcp/stdio.ts` from the implementation tree. OpenCode permissions deny bash, edit, web, codesearch, task, skill, and external directories. The recipient config registers no MCP server.

The runner refuses to start unless `src/` and `package.json` still match the implementation commit, the control tree is the control commit, and the installed harness versions match this file.

Before any scored run, on October 10, 2026:

- `sandbox-exec` denied a read of `fixtures/recall/rcl-001/ground-truth.md`.
- Codex `gpt-5.6-sol` and OpenCode `opencode/space-bunny-free#xhigh` each replied READY through this runner.
- The control MCP server listed `get_workspace_context` and did not list `recall_workspace`. A recall call was rejected.
- The treatment MCP server listed `recall_workspace`. For `ws_rcl001_s1` and `partner callback` it returned current total 4 and historical total 1.
- `campfire handoff-packet` wrote a mode-0600 file. The receipt omitted the query. The file carried the offline-copy authority line and did not contain a token or the correction reason.

## After the first scored run

Do not edit the answer key (`ground-truth.md`) after the first scored run. Do not edit the frozen prompts, recall queries, rubric, or isolation rule to fit an output. Record a deviation instead of changing the key.
