# SHR-001 evidence

**Status:** Engineering evidence for the v1.26.2 candidate; no release claim.

| File | Purpose |
| --- | --- |
| `step-0/README.md` | Index and installed capture summary |
| `step-0/STEP0.md` | Baseline pins, reproduction, decisions, risks |
| `step-0/INTERFACE-CONTRACT.md` | CLI/HTTP/schema/limits/receipts |
| `step-0/SNAPSHOT-MANIFEST.md` | Table allowlist, exclusions, validation |
| `step-0/ANSWER-KEY.md` | Arbora identity, counts, tip, digest |
| `step-0/THREAT-MODEL.md` | Threats, controls, operator responsibility |

Engineering acceptance:
`tests/acceptance/shr-001-publish-share.test.ts`. The physical two-Mac run is
**NOT OBSERVED**. See `docs/SPRINT_SHR_001_RESULT.md` for the full matrix.
