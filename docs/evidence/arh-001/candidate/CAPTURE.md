# ARH-001 candidate — direct Viewer inspection (browser capture evidence)

**Date:** October 16, 2026 (pre-commit verification pass, independent verifier harness)
**Method:** local Viewer (`npx tsx src/cli/index.ts view`) bound to a scratch instance of the frozen ARH-001 lab fixture (seeded by `fixtures/artifact-handoff/arh-001/seed.ts` with the frozen served clock), loaded headless with the machine-cached Playwright 1.63.0 / Chromium (`chromium-1243`). No repository dependency was added; the scratch database and viewer process were removed after capture.

## Captures

| File | What it shows |
| --- | --- |
| `viewer-open-anchors-wide.png` | Artifact group rendered wide: exactly the three `openable https` rows carry the labeled deliberate open control with the destination host in the label ("Open <host> (external, unverified)"); every other class (`credential-bearing`, `other scheme`/`ftp:`, `local path`, `unparsed`, hostile markup) shows only the inert class label; every row carries "stored reference, not fetched" and the external-unverified caveat. |
| `viewer-open-anchors-narrow.png` | Same at a narrow viewport (420 px): no horizontal overflow; hover passes make no additional network requests. |

## Asserted during the capture (all PASS)

- Anchor attributes: `target="_blank"`, `rel="noopener noreferrer"`, `referrerpolicy="no-referrer"`; href equals the stored absolute HTTPS reference; tab-focusable (keyboard reachable).
- Zero non-loopback network requests during load, hover, and 2 s idle on both viewport passes (only loopback Viewer reads).
- Hostile markup displayed as escaped literal text; credential-bearing URL rendered `credential-bearing` with **no** anchor; terminal projection (separate harness evidence) renders no open control at any width.

## Sanitization

Contents are synthetic lab-fixture data only (example.com-style demo targets, lab ids); no token values, invitations, private URLs, or unrelated workspace content appear. Full network-request table and assertions are recorded in this sprint's verification session transcript; the committed evidence is these two images and this note.

SHA-256:

- `2958bee72c62161630729e4a0c7a018c9dbdc62155064060f27feddac9f62749` — viewer-open-anchors-narrow.png
- `ec68b4296ce7c015f67b410696129842832bb85947cb579736253c9342a51d41` — viewer-open-anchors-wide.png

This capture is engineering evidence for the scoped candidate (scope §6, D3/D5). It does not observe, prove, or assert any human outcome, external access success, or handoff; ARH-001's human observations remain NOT OBSERVED.
