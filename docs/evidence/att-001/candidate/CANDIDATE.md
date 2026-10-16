# ATT-001 candidate evidence

**FIXTURE EVIDENCE + CANDIDATE CAPTURE — implementation evidence only; cannot establish Gate B, C, E, or F and is not a human comprehension result.**

Captured from the ATT-001 candidate working tree that is snapshotted as the candidate commits (recorded in `docs/SPRINT_ATT_001_RESULT.md`). Package version remains `1.18.0`: no version bump, tag, release, or deployment is authorized by the sprint contract.

Fixture: `att-001 fixture v2` (`fixtures/attention/att-001/`, default record-level assertions; scenario repair in `../baseline/SCENARIO_REPAIR.md`).

## Product file hashes (candidate tree)

| File | sha256 |
| --- | --- |
| `src/service/service.ts` | `4a1ad66898b162649dfd946aa6a37f85ade3195c94316042da5fa3cc8b80f74e` |
| `src/service/campfire-service.ts` | `c0e51ba30cc42be7477f183e2815002577d8cb5e17daf1488642632e829a1791` |
| `src/service/context-assembly.ts` | `542d5205a2570485d3170d44582f0e00a40e0a117bb3722ec416eb1c1f625c1c` |
| `src/worker/async-service.ts` | `9d9846f0f74daa811d26c8b7149d7b636e7cee95caf17a2d669a14ecb405663c` |
| `src/cli/index.ts` | `6aa31269494e89f13c54904ecb54293a1b99c0219a67e49a607eea8d225251ef` |
| `src/cli/projections.ts` | `1ae1ec64cd4727a9cb48577ddd5aa2e89a512e5a87772c7775832d09c45caad0` |
| `src/mcp/tools.ts` | `c64a041a67a7b9e65ccfbac26bf772633dd1d88922973209847bc1f7fbaeb1c3` |
| `src/viewer/static/app.js` | `8fd39493bdc0d5edd630a8ea010e66a570f4c220bb23937e7f2575cd8e1adbcb` |
| `src/viewer/static/index.html` | `3fc21f80f2f707bcf543ab39148e9cd9bb7bd1e433a2a63343bbbd55a2474260` |
| `src/viewer/static/app.css` | `1bf8b32eba1a58e5b41a3940b29a1ae9907a24913d0462181c2bf8de1464f560` |
| `tests/integration/att-001.test.ts` | `59a179fb6f883afa70dfaa22b866824ddb437ee19d03ff2162300284750dc3fb` |

## Commands

```sh
npx tsx fixtures/attention/att-001/seed.ts --out fixtures/attention/att-001/.tmp/candidate --force
npx tsx fixtures/attention/att-001/dump.ts --db fixtures/attention/att-001/.tmp/candidate/campfire.db --tokens fixtures/attention/att-001/.tmp/candidate/tokens.json --out fixtures/attention/att-001/.tmp/candidate/dump
NODE_PATH=…/att-001-pw/node_modules npx tsx fixtures/attention/att-001/capture-viewer.ts --db fixtures/attention/att-001/.tmp/candidate/campfire.db --out fixtures/attention/att-001/.tmp/capture-candidate --label candidate
```

Dump and capture ran against the candidate service and Viewer (same fixture database). Sanitization scan over this directory for token values, `cft_`, `/Users/`, and the unrelated sentinel: **zero matches**.

## Observed candidate behavior vs `../SCENARIO_KEY.md`

- `context-ws_att001_lab-ana.json`: `attentionCoverage` tasks 20/21 truncated, decisions 7/7 complete, `completeUnderRules: false`; `needsYou` = assigned blocked + open tasks; `needsAttention` = unassigned blocked, team blocked, and **both** review cues (superseded, withdrawn) with their cited non-current finding ids.
- `context-ws_att001_lab-ben.json`: `needsYou` empty while the task page is truncated (the incomplete-empty H4 observation); `needsAttention` carries the team blocked/unassigned cues and both review cues.
- `context-ws_att001_trunc_decisions-ana.json`: the in-page review decision gets a cue; the beyond-page review decision does not, with decisions 10/12 truncated — a coverage limitation, not an unqualified all-clear.
- `context-ws_att001_quiet-*.json`: complete pages, empty attention, `team_open_task` fallback points at the visible unassigned open task.
- `context-ws_att001_trunc_tasks-*.json` and `context-ws_att001_trunc_both-*.json`: empty or in-page cues with truncated source pages disclosed by `attentionCoverage`.
- `denials.json`: Ana's read of `ws_att001_unrelated` is denied with no sentinel or record leak.
- `captures/` and `text/`: candidate Viewer (coverage lines, plain-language reason labels, review cues, assignment note) for Ana and Ben across the five authorized workspaces, both perspectives.

These captures are the candidate counterpart to `../baseline/`; they are not a scored D1–D6 result (see `docs/SPRINT_ATT_001_RESULT.md`) and not a human comprehension result.
