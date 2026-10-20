# CAP-001 Step 0 evidence

**Date:** 2026-10-20  
**Status:** Freeze before product code.  
**Label: FIXTURE EVIDENCE — engineering evidence only.** Nothing here is a human observation or a sprint verdict. It is not `docs/SPRINT_CAP_001_RESULT.md`.

The dated record is `STEP0.md`. It freezes the v1.24.1 CLI manifest, MCP `tools/list`, the paired-operation map, the fixture answer key, the harness gap, and the proposed search/recipe contract.

## Files

| Path | What it is |
| --- | --- |
| `STEP0.md` | Release pin, reproduction, error-code decision, digests. |
| `cli/` | Playbook-off and playbook-on `capabilities --output json`, command order, and one `ValidationError` in human and JSON. |
| `mcp/` | Playbook-off and playbook-on `tools/list`, plus the `fail()` envelope and the different SDK validation shape. |
| `paired-operations.md` | Field map. Not a claim that every command has one MCP twin. |
| `answer-key.json`, `ANSWER_KEY.md` | Frozen fixture ids, cursors, coverage, and handoff limits. |
| `HARNESS_BASELINE.md` | Codex and OpenCode paths, both **NOT OBSERVED**. |
| `proposed/` | Search schema, alias map, two recipes, query answer key, compatibility snapshot. |
| `SHA256SUMS` | sha256 of the captured CLI/MCP bytes and `answer-key.json`. |

Do not commit `fixtures/cap-001/.tmp/`, tokens, or a database. The seed source is `fixtures/cap-001/seed.ts`.
