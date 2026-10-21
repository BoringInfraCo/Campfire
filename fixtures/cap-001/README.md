# fixtures/cap-001

**Label: FIXTURE EVIDENCE — engineering evidence only.** Not a human observation and not a sprint verdict.

`seed.ts` builds one authorized workspace (`ws_cap001_lab`, actor `hum_cap001_ada`), one workspace that actor must not read (`ws_cap001_other`, owner `hum_cap001_zed`), and 21 blocked tasks so `task_cap001_blocked_later` is absent from the first `list_tasks` page and from `get_workspace_context` tasks and blockers.

The selected decision cites one current finding and one superseded finding. `needsReview` is computed at read time. It is not stored as revocation.

```sh
CAMPFIRE_TELEMETRY=0 npx tsx fixtures/cap-001/seed.ts --out fixtures/cap-001/.tmp/served --force
```

The database stays under `.tmp/` and is gitignored. The seed does not write tokens. Service authz lines may precede one JSON object on stdout. The frozen answer key is `docs/evidence/cap-001/step-0/answer-key.json`. Do not copy these ids into catalog or recipe prose.

`contract/` holds byte-identical copies of the frozen Step 0 catalog, queries, aliases, recipes, search schema, and answer key. The exported tests read these copies; a private parity test (`tests/unit/cap-001-step0-parity.test.ts`) verifies they still match `docs/evidence/cap-001/step-0/`. The metadata path strings inside `queries.json` name the private evidence record and are not runtime paths.

The other-workspace finding summary is a canary. Ada's denial text and the answer key must not contain it.
