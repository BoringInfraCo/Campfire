# CAP-001 proposed search and recipe schema

**Date:** 2026-10-20  
**Label: FIXTURE EVIDENCE.** This is the contract later code must match. It is not an implementation and not a sprint verdict.

The answer key for queries is `queries.json`. Operation bodies are `catalog.json`. Alias strings are `aliases.json`. Full recipes are `continue-blocked-work.json` and `review-decision-basis.json`.

## Search projection

`kind` is `capability_search`. `catalogVersion` is `1`. Fields:

```text
query
returned
totalMatches
truncated
entries[]
recipeSummaries[]
```

`entries[]` is `{id, purpose, effect, scope, requiredInputs:[{name,type}], preconditions:[], outputCaveat, surfaces:{cli,mcp}}`.

Each surface is exactly one of `{usage}`, `{tool}`, or `{unavailable: <short reason>}`. It never contains a live argument value.

`recipeSummaries[]` is `{id, purpose}`. `purpose` is the recipe `goal` string. Summaries are not the full recipe.

`returned` is `entries.length`. `totalMatches` counts matching operations before the limit and does not count recipes. `truncated` is true when matching operations were withheld. `catalogVersion` changes only for an incompatible projection change.

Alias strings are search metadata. They are not copied onto entries.

## Normalization and errors

Apply these checks in order:

1. If any code point is below U+0020 or is U+007F, return `ValidationError` with `details.field` `query`. Tab, newline, and NUL are controls, not whitespace to collapse.
2. Trim leading and trailing U+0020 and collapse internal runs of U+0020 to one space.
3. If that string is empty, `ValidationError` field `query`.
4. If its length is greater than 120, `ValidationError` field `query`. Length 120 is allowed.
5. Lowercase the string. The projection `query` is this value. Split on U+0020 into tokens.

A bad limit is an integer outside `1..10`, or any non-integer. `ValidationError` field `limit`. Omitted limit means 8. Maximum is 10. Validate the query before the limit, so an empty query with a bad limit reports field `query`.

An unknown recipe id is `ValidationError` field `id`. It is not a search result.

The contract's words "VALIDATION_ERROR" mean this existing code string `ValidationError`. Do not invent a new code. CLI failures use `{error:{code,message,details?}}` on stderr. MCP `fail()` uses `{error,message,details}` text with `isError: true`. `details.field` for these new failures is only `query`, `limit`, or `id`.

Stable messages:

| Field | Message |
| --- | --- |
| `query` | `Query is empty, contains a control character, or is longer than 120 characters.` |
| `limit` | `Limit must be an integer from 1 to 10.` |
| `id` | `Unknown read recipe id.` |

## Matching

A token matches an operation when it is a substring of the operation's id, purpose, alias strings, CLI `usage`, or MCP `tool` name. Do not search `outputCaveat`, `preconditions`, required-input names, or `unavailable` text. Do not evaluate a regex, a program, a shell command, a remote index, or a URL.

Every token must match. Sort matching operation ids by Unicode code point, ascending.

A token matches a recipe when it is a substring of the recipe id or `goal`. Steps are not searched. Every token must match. Keep at most 2 summaries, in the frozen order `continue-blocked-work` then `review-decision-basis`. A recipe-only match returns that summary and does not increment `totalMatches`.

Zero matches means both arrays empty, `totalMatches` 0, and `truncated` false.

The limit applies to operation entries only. The JSON projection is at most 16 KiB. Bound field lengths as follows, then omit whole entries from the end of the limited list and set `truncated`; never cut a JSON value or a required caveat. The frozen queries in `queries.json` are under this budget, so their `truncated` flags come only from the entry limit.

| Field | Maximum characters |
| --- | --- |
| operation `id`, input `name` | 64 |
| input `type` | 32 |
| `purpose`, recipe `goal` | 400 |
| each precondition, `outputCaveat`, `usage`, `tool`, `unavailable` | 400 |
| echoed `query` | 120 |

Search text must not contain workspace names, workspace ids, row counts, membership verdicts, tokens, secrets, environment values, or credential receipts. A match is not a grant. `available` must not be added as a synonym of authorized.

`get_playbook` stays omitted unless the existing playbook gate is on.

## Recipes

`kind` is `read_recipe`. `recipeVersion` is `1`. The object is `{kind, recipeVersion, id, goal, steps, resultContract}`. Each step is `{operationId, inputsFrom, surfaces, stopWhen, coverageCaveat}`. `inputsFrom` is `client selection` or a prior result field name. It is never a fixture id. Neither recipe embeds a workspace record. Each file is under 8 KiB.

`get_record_history` has no CLI usage. Its CLI surface is `unavailable`. `campfire activity` is not that read.
