# NAV-002 Step 0 evidence

**Date:** 2026-10-18  
**Label: FIXTURE EVIDENCE — engineering evidence only.** Nothing here is a human observation. The human comparison is **NOT OBSERVED**.

The dated packet is `STEP0.md`. It freezes the released v1.22.1 gap, the read contract to implement, and the same-fixture answer sheet. Do not treat it as an implementation result.

## Reproduce the released baseline

Use a disposable worktree of the product commit, not the current checkout (this checkout's seed has the Zed owner exception). Remove the worktree when the capture exists. Pass `realpath` of that worktree so the capture tool redacts the system-temp prefix.

```sh
git worktree add --detach "$WT" fd38eb20703167cbf9ea1c30b7b8cd92661a9b45
cd "$WT" && npm ci --no-audit --no-fund
cd "$WT" && node_modules/.bin/tsx fixtures/navigator/nav-001/seed.ts \
  --out fixtures/navigator/nav-001/.tmp/released --force
# from this checkout, after Step 0:
npx tsx fixtures/navigator/nav-001/capture-dashboard.ts \
  --root "$(realpath "$WT")" \
  --db "$(realpath "$WT")/fixtures/navigator/nav-001/.tmp/released/campfire.db" \
  --workspace ws_nav001_lab --actor hum_nav001_ana \
  --out docs/evidence/nav-002/baseline/terminal \
  --label baseline-v1.22.1-ana-lab
git worktree remove --force "$WT"
```

Frames differ from the committed files only in the wall-clock `refreshed` line. The authorized JSON in `baseline/json/` was read through that worktree's `dispatchCampfireMethod` with the clock frozen at `2026-10-17T14:00:00.000Z`. Do not commit `tokens.json` or the database.

That baseline seed is the released fixture: `agt_nav001_03` is still owned by `hum_nav001_h03`. The answer sheet uses the extended seed below.

## Reproduce the extended fixture

```sh
npx tsx fixtures/navigator/nav-001/seed.ts --out fixtures/navigator/nav-001/.tmp/run-a --force
npx tsx fixtures/navigator/nav-001/seed.ts --out fixtures/navigator/nav-001/.tmp/run-b --force
npx tsx fixtures/navigator/nav-001/dump.ts --db fixtures/navigator/nav-001/.tmp/run-a/campfire.db \
  --out fixtures/navigator/nav-001/.tmp/run-a/dump
npx tsx fixtures/navigator/nav-001/dump.ts --db fixtures/navigator/nav-001/.tmp/run-b/campfire.db \
  --out fixtures/navigator/nav-001/.tmp/run-b/dump
diff -r fixtures/navigator/nav-001/.tmp/run-a/dump fixtures/navigator/nav-001/.tmp/run-b/dump
```

Recorded on 2026-10-18: both seeds exited 0 and the dump trees were byte-identical. `npx vitest run tests/unit/nav-001-dashboard.test.ts` passed (19 tests). The seed asserts the first task-page order, Ana's second agent, and Zed's ownership of `agt_nav001_03`.
