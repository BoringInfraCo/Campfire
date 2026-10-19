# NAV-003 Step 0 evidence

**Date:** 2026-10-19  
**Label: FIXTURE EVIDENCE — engineering evidence only.** Nothing here is a human observation. The contract §8 comparison is **NOT OBSERVED**. This packet is not a verdict and not `docs/SPRINT_NAV_003_RESULT.md`.

The dated record is `STEP0.md`. It freezes the released v1.23.0 Viewer gap, the twelve-method allowlist, the denial matrix, and the same-fixture answer key. Do not treat it as an implementation result.

## Files

| Path | What it is |
| --- | --- |
| `STEP0.md` | Release pin, reproduction, Viewer gap versus the terminal, allowlist, denial matrix, keyboard path, byte budget, source field map. |
| `json/answer-key.json` | Sanitized authorized reads at `2026-10-17T14:00:00.000Z`. No tokens. |
| `json/measurements.json` | Compact UTF-8 byte sizes for those reads. Not a claim of arbitrary scale. |
| `json/denials.json` | Zed on the lab, Ana on the unrelated workspace, missing workspace, unrelated finding id. |
| `terminal/` | Opening `campfire dashboard` frames, 80×24 and 120×36, from the v1.23.0 worktree. |
| `viewer/` | Viewport screenshots and `document.body.innerText` at 1440×900 and 390×844, one keyboard path, and the served request trace. |
| `SHA256SUMS` | sha256 of the files above. |

Do not commit `tokens.json`, the seeded database, or `node_modules`. The disposable worktree used for this capture has been removed.
