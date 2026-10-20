# CAP-001 D7 public-copy / export audit

**Date:** 2026-10-20  
**Candidate:** `59e48e1455afbc6c894c3a692bf13dd393375da7`  
**Package version:** `1.24.1` (unchanged)  
**Label:** local export audit only. **This export is not a publication.** No version bump, tag, push, installer edit, channel pin, or deployment was performed. The snapshot was not copied into the repository.

The main working tree had untracked `scripts/capture-billing-viewer.ts` and `scripts/seed-billing-evidence.ts`. `scripts/export-public-release.mjs` refuses a dirty tree, so the export ran from a detached worktree of the candidate commit. That worktree was removed after the checks below. The snapshot remains at `/tmp/cap-001-public-export`.

## Command

From `/tmp/cap-001-export-src` (detached at the candidate):

```text
node scripts/export-public-release.mjs --ref 59e48e1455afbc6c894c3a692bf13dd393375da7 --output /tmp/cap-001-public-export
```

## Script result

| Field | Value |
| --- | --- |
| Exit code | `0` |
| Stderr | empty |
| Printed version | `v1.24.1` |
| Source SHA | `59e48e1455afbc6c894c3a692bf13dd393375da7` |
| File count | `349` (script line `wrote 349 files`; `PUBLIC_SNAPSHOT_MANIFEST.json` lists 349 paths, including itself) |

Stdout:

```text
export-public-release: v1.24.1
export-public-release: source 59e48e1455afbc6c894c3a692bf13dd393375da7
export-public-release: wrote 349 files to /tmp/cap-001-public-export
```

The script's own forbidden-path and secret-like-content scan passed (it exits non-zero on those failures). Manifest `version` is `1.24.1` and `sourceCommit` matches the candidate.

## Allowlist (why these paths are or are not copied)

`scripts/export-public-release.mjs` copies blobs from the source commit only when `sourcePathAllowed` is true:

- exact paths in `EXACT_SOURCE_PATHS` (selected root, packaging, workflow, and five docs: `ARCHITECTURE.md`, `OPERATOR.md`, `PRODUCT_DEFINITION.md`, `TELEMETRY.md`, `VISION.md`);
- or a path under `SOURCE_PREFIXES`: `fixtures/`, `migrations/`, `public/`, `src/`, `tests/`.

It then drops `PRIVATE_SOURCE_PREFIXES` (`fixtures/incidents/wow-001/` and the RCL recall packets) and `PRIVATE_SOURCE_PATHS` (three named unit tests). `fixtures/cap-001/` is not in that private set.

After copy, `auditExport` rejects a path matching `FORBIDDEN_PATH` (including an `evidence` path segment, `docs/internal`, secrets-file names, `.git`, `dist`, `skills`, and similar) and text matching `FORBIDDEN_CONTENT` (private key, GitHub token, OpenAI-style secret, AWS access key, Campfire bearer token, absolute macOS user path, absolute Windows user path). `dist/` is not copied. There is no compiled catalog in the snapshot.

`docs/` is exact-path only, so `docs/evidence/` is not copied. A path whose segment is `evidence` would also fail `FORBIDDEN_PATH`.

## Source / public Viewer parity

Run in the worktree. `diff -q` printed nothing. Each exit code was `0` (files are identical).

| Command | Result |
| --- | --- |
| `diff -q src/viewer/static/index.html public/index.html` | identical (exit 0) |
| `diff -q src/viewer/static/app.css public/app.css` | identical (exit 0) |
| `diff -q src/viewer/static/app.js public/app.js` | identical (exit 0) |
| `diff -q src/viewer/static/campfire-mark.svg public/campfire-mark.svg` | identical (exit 0) |

## Snapshot contents checked after export

| Check | Result |
| --- | --- |
| CAP-001 catalog | **Present** as source `src/catalog/capability-search.ts`. No compiled equivalent is copied. |
| `docs/evidence` | **Absent.** Exported docs are only the five exact allowlisted files. |
| Secret-like content | **No matches.** Re-scan of the snapshot against the script's seven `FORBIDDEN_CONTENT` labels found none. No file/rule pair to name. |
| `fixtures/cap-001` | **Present.** Not excluded by the allowlist. Copied files: `fixtures/cap-001/.gitignore`, `fixtures/cap-001/README.md`, `fixtures/cap-001/seed.ts`. |

## Verdict

**Exporter audit: PASS** (exit 0). Forbidden paths and secret-like patterns were not reported.

**Requested absence of `fixtures/cap-001`: NOT MET.** The public copy includes that fixture source because `fixtures/` is an allowlisted prefix and `fixtures/cap-001/` is not a private prefix. This note does not change `docs/SPRINT_CAP_001_RESULT.md` and does not treat the snapshot as a release.
