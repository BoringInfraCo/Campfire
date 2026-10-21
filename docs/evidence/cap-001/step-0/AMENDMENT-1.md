# CAP-001 Step 0 — Amendment 1

**Date:** 2026-10-20  
**Status:** Dated amendment to the Step 0 freeze. No behavioral contract, query answer, recipe step, or fixture fact changes.  
**Label: FIXTURE EVIDENCE — engineering evidence only.**

## Why

Release-prep review found two defects in the frozen packet:

1. The new CAP-001 tests read `docs/evidence/cap-001/step-0/` directly. The public exporter intentionally excludes `docs/evidence/`, so the public snapshot would have contained the tests without the data and failed at collection.
2. The frozen `catalog.json` described the `capabilities` MCP surface as unavailable "until discover_capabilities exists." That sentence became false when the tool shipped and would have been served as the search projection's unavailable reason.

## What changed

- The frozen JSON and schema files are copied byte-for-byte to `fixtures/cap-001/contract/`. Exported tests read the copies. A private parity test, `tests/unit/cap-001-step0-parity.test.ts`, fails if any copy drifts from the Step 0 evidence. The parity test is excluded from the public snapshot because it reads `docs/evidence/`.
- `proposed/catalog.json` and the inline corpus now say: `CLI manifest only; MCP provides tools/list and discover_capabilities`.
- `docs/evidence/cap-001/candidate/HARNESS_SMOKE.md` now says the smoke made no product change and that the evidence file was committed later; its OpenCode heading names the discovery gap instead of calling the whole run a pass.

## What did not change

- No change to `queries.json` cases, expected entry or recipe ids, limits, normalization, or error shapes.
- No change to `answer-key.json`, fixture ids, cursors, coverage, currentness, history, denial, or handoff limits.
- No change to either recipe file, the alias map, the search schema, or the compatibility snapshot.
- `SHA256SUMS` still covers the captured CLI/MCP bytes and the unchanged `answer-key.json`. `catalog.json` was not one of its covered files.

The behavioral answer key remains the frozen Step 0 record. This amendment changes test placement and corrects one now-false description; it does not move the baseline.
