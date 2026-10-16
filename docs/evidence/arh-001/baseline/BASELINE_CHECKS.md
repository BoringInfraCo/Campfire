# ARH-001 baseline checks — v1.20.1 engineering checks

**FIXTURE / ENGINEERING EVIDENCE — cannot establish Gate B, C, or E.**
Checks run on the frozen baseline; no product change is evaluated. Pin:
`PIN.md` (HEAD `76db5be`, product files byte-identical to tag commit
`dc3c2a4`). All commands were run from the repository root on 2026-10-16.

## 1. Typecheck

```sh
npm run typecheck
```

Result: `tsc --noEmit`, **no output, exit status 0**.

Note: `tsconfig.json` includes `src/**/*.ts`, `tests/**/*.ts`,
`scripts/**/*.ts`; the fixture directory is outside the project typecheck (the
existing policy applies to `seed.ts`/`dump.ts` too). The three capture scripts
added by this baseline were therefore also typechecked ad hoc with the same
strict flags:

```sh
npx tsc --noEmit --strict --noUncheckedIndexedAccess --target ES2022 \
  --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node \
  --forceConsistentCasingInFileNames \
  fixtures/artifact-handoff/arh-001/capture-dashboard.ts \
  fixtures/artifact-handoff/arh-001/capture-viewer.ts \
  fixtures/artifact-handoff/arh-001/capture-mcp.ts
```

Result: **no output, exit status 0**. All three scripts were additionally
executed end-to-end (see `captures/*/capture-summary.json`).

## 2. Full test suite

```sh
npm test
```

(=`vitest run`) Result, verbatim summary:

```
 Test Files  93 passed (93)
      Tests  1126 passed | 1 skipped (1127)
   Duration  44.83s (tests 83%, import 13%, transform 3%, setup 1%, worker 1%)
```

Exit status 0. The single skipped test is the explicit opt-in terminal
evidence capture,
`tests/unit/uix-001-dashboard-pty.test.ts:328`
(`it.skipIf(!CAPTURE_ENABLED)(...)`, enabled only with
`CAMPFIRE_UIX_CAPTURE=1`); it is the only skip in the suite. Test isolation
comes from `tests/setup-profile-env.ts` (per-test temporary
`CAMPFIRE_CONFIG_DIR`/`CAMPFIRE_DATA_DIR`/`HOME`).

## 3. Build and public Viewer asset sync

```sh
git status --porcelain > /tmp/arh001-status-before-build.txt
npm run build
git status --porcelain > /tmp/arh001-status-after-build.txt
diff /tmp/arh001-status-before-build.txt /tmp/arh001-status-after-build.txt
for f in index.html app.css app.js campfire-mark.svg; do cmp src/viewer/static/$f public/$f && echo "SYNC_OK $f"; done
```

Results:

- `npm run build` (script:
  `npm run sync:public && tsc && cp src/store/schema.sql dist/src/store/schema.sql && rm -rf dist/src/viewer/static && cp -r src/viewer/static dist/src/viewer/static && chmod +x dist/src/cli/index.js`)
  exited 0.
- `git status --porcelain` was **unchanged** by the build (`diff` of the two
  snapshots printed nothing; recorded `STATUS UNCHANGED`). No tracked file was
  modified; nothing needed to be restored with `git checkout --`.
- `cmp` printed nothing for every pair and each `cmp` exited 0:
  `SYNC_OK index.html`, `SYNC_OK app.css`, `SYNC_OK app.js`,
  `SYNC_OK campfire-mark.svg` — the public Viewer assets match
  `src/viewer/static/` after the build.
- Post-build sha256 values equal the pinned shell hashes in `PIN.md` §6
  (`26020d21…` index.html, `0a085442…` app.css, `fa7684fd…` app.js,
  `a845ec97…` campfire-mark.svg).

## 4. Determinism (fixture)

Fresh seed → dump ×2, byte-compare: `diff -r` printed nothing, exit status 0
(full command sequence and result in `PIN.md` §5). The committed
`served-state/` is a copy of a third fresh `served` seed's dump and compares
clean against both runs.

## 5. Evidence integrity (SHA256SUMS)

`SHA256SUMS` in this directory lists every file under
`docs/evidence/arh-001/baseline/` except itself (51 files) plus the three
fixture capture scripts
(`fixtures/artifact-handoff/arh-001/capture-dashboard.ts`,
`fixtures/artifact-handoff/arh-001/capture-viewer.ts`,
`fixtures/artifact-handoff/arh-001/capture-mcp.ts`) — 54 entries.

```sh
shasum -a 256 -c docs/evidence/arh-001/baseline/SHA256SUMS
```

Result: all 54 entries report `OK`, no failures, exit status 0 (the file has
56 lines: the two `#` header/comment lines plus the 54 entries).

## 6. Not run

- `npm run pack:tarball` — **not run**: no release-shaped candidate exists
  for this baseline record, and ARH-001 is not a publication step.
- `npm run deploy:dry-run` — **not run**: same reason; no deployment artifact
  is proposed by this baseline.

Both commands belong to release-shaped candidate verification
(`docs/Campfire-v1.21-ARH-001-Artifact-Reference-Handoff.md` §5); this
baseline records checks on the frozen published source only.
