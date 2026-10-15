# SWH-001 controlled trace runbook

Turnkey commands, verified 2026-10-14 (UTC) on this machine. Run everything from
the repository root. `FIXTURE EVIDENCE` rules apply: no token enters any
committed file, and the participant never sees this runbook.

## 0. Prerequisites

- `npx tsx` available (repo dev dependency), Node ≥ 22.
- The frozen scenario in `fixtures/swh-001/seed.ts`; SQLite output stays under
  `fixtures/swh-001/.tmp/` (gitignored — no database is committed).

## 1. Build the scenario

```bash
npx tsx fixtures/swh-001/seed.ts --out fixtures/swh-001/.tmp/run-a --force
```

- Deterministic ids and clock (base `2026-10-13T16:00:00.000Z`, +1 s per write).
- Writes `fixtures/swh-001/.tmp/run-a/campfire.db`, `tokens.json` (mode 0600),
  and `seed-receipt.json`; prints the key ids and the four tokens to stdout.
- Default output (without `--out`) is `fixtures/swh-001/.tmp/served`.
- The seed self-verifies the served projection (slice bounds, decision/finding
  relationships, attention items) and fails if the scenario drifts.

Re-dump the frozen served state (for comparison; never hand-edit dumps):

```bash
npx tsx fixtures/swh-001/dump.ts \
  --db fixtures/swh-001/.tmp/run-a/campfire.db \
  --tokens fixtures/swh-001/.tmp/run-a/tokens.json \
  --out fixtures/swh-001/.tmp/dumps-a
```

Two fresh runs must produce byte-identical dumps:

```bash
npx tsx fixtures/swh-001/seed.ts --out fixtures/swh-001/.tmp/run-b --force
npx tsx fixtures/swh-001/dump.ts --db fixtures/swh-001/.tmp/run-b/campfire.db \
  --tokens fixtures/swh-001/.tmp/run-b/tokens.json --out fixtures/swh-001/.tmp/dumps-b
diff -r fixtures/swh-001/.tmp/dumps-a fixtures/swh-001/.tmp/dumps-b
# expected: no output
```

## 2. Start two actor-bound loopback Viewers

The local Viewer binds identity from the actor token: `withBackend`
(`src/cli/index.ts`) reads `--token` (or `CAMPFIRE_TOKEN`), and with no
`CAMPFIRE_URL` it resolves the token through `runtime.service.resolveToken`,
fixing the actor for every `/api/call` the Viewer makes (`src/cli/index.ts:273–307`,
`src/cli/index.ts:2075–2096`). The database path comes from `CAMPFIRE_DB`
(`src/config.ts:29–39`: `CAMPFIRE_DB`/`--db` → profile → `$CWD/.campfire` → XDG).
The browser receives no token; each participant must use their **own** listener.

Terminal A — Dana on port 9415:

```bash
DB="$PWD/fixtures/swh-001/.tmp/run-a/campfire.db"
CAMPFIRE_DB="$DB" npx tsx src/cli/index.ts view --port 9415 \
  --token "$(node -p "require('$PWD/fixtures/swh-001/.tmp/run-a/tokens.json').dana")"
```

Terminal B — Rowan on port 9416:

```bash
DB="$PWD/fixtures/swh-001/.tmp/run-a/campfire.db"
CAMPFIRE_DB="$DB" npx tsx src/cli/index.ts view --port 9416 \
  --token "$(node -p "require('$PWD/fixtures/swh-001/.tmp/run-a/tokens.json').rowan")"
```

Both log `[campfire] viewer listening on http://127.0.0.1:9415` / `:9416` to
stderr and stay in the foreground until SIGINT/SIGTERM. Point the participant's
browser at `http://127.0.0.1:9415` (Dana) or `http://127.0.0.1:9416` (Rowan).

## 3. Verify actor binding (observed output from this run)

```bash
curl -s http://127.0.0.1:9415/api/call -d '{"method":"whoami"}' -H 'content-type: application/json'
# {"ok":true,"result":{"actor":{"actorId":"hum_swh001_dana","actorType":"human"}}}

curl -s http://127.0.0.1:9416/api/call -d '{"method":"whoami"}' -H 'content-type: application/json'
# {"ok":true,"result":{"actor":{"actorId":"hum_swh001_rowan","actorType":"human"}}}
```

Observed 2026-10-14, exactly as above. Additional verified check that both
listeners serve the same authorized projection while differing where the service
says they differ:

```bash
curl -s http://127.0.0.1:9415/api/call -H 'content-type: application/json' \
  -d '{"method":"get_workspace_context","params":{"workspaceId":"ws_swh001_billing"}}'
```

- Dana's `needsYou`: `proposed_decision_actionable` `dec_swh001_friday_windows`,
  `assigned_blocked_task` `task_swh001_staging_check`; `needsAttention`:
  `unassigned_blocked_task` `task_swh001_escalation_owner`.
- Rowan's `needsYou`: `proposed_decision_actionable` `dec_swh001_friday_windows`,
  `assigned_open_task` `task_swh001_review_drill`; `needsAttention`:
  `unassigned_blocked_task` `task_swh001_escalation_owner` and
  `team_blocked_task` `task_swh001_staging_check`.
- Artifacts slice is `total 12 / returned 10 / truncated true` in both.
- The live `generatedAt` is the real read time (the frozen dumps use
  `2026-10-13T18:00:00.000Z`); `orientationCursor` is identical to
  `served-state/` (tip `con_swh001_0113`).

If `--token` ever fails to bind through a later CLI change, the equivalent
verified mechanism in this build is `CAMPFIRE_TOKEN=<token>` in the environment
(`readCampfireToken` checks the `--token` flag first, then `CAMPFIRE_TOKEN`;
both override `readOperatorHumanToken()`). Verified 2026-10-14:
`CAMPFIRE_DB=… CAMPFIRE_TOKEN=<dana token> npx tsx src/cli/index.ts view --port 9417`
answers `hum_swh001_dana`.

Do **not** rely on `--actor`/`--type` alone on a machine with an operator
profile: `withBackend` prefers the stored operator token before the actor
fallback, so the Viewer fails at startup with `[Unauthorized] Invalid or revoked
token` against a fixture database (observed 2026-10-14). The token flag/env is
the supported binding path.

## 4. During the session

- Participant uses the normal Viewer inspection controls only; **no CLI or MCP**
  until the seven questions are answered and scored (contract §6.2).
- The recorder does not confirm answers, does not show this runbook or the key,
  and notes every hint. A hint that supplies an answer fails that item.
- A real reference-open attempt during ordinary work is recorded separately in
  `REFERENCE_OBSERVATION.md`; the Viewer must not fetch or preview it.

**H4 historical record (scoring rule):** the superseded decision H4 asks about
is not returned by the orientation read; it is reachable only through the
workstream/detail drill-down. Do not point to the workstream, name the record,
or open it for the participant. If the participant does not reach it, the keyed
fact is not met and H4 scores **FAIL**; record the miss as an observed usability
result. A hint that supplies an answer fails that item; never coach, correct, or
re-ask after a hint.

## 5. Stop and reset

Stop the two viewers with `Ctrl-C` in terminals A and B (or
`kill <pid>`/`pkill -f "tsx src/cli/index.ts view"`).

```bash
# Fresh database for a new trace:
npx tsx fixtures/swh-001/seed.ts --out fixtures/swh-001/.tmp/run-a --force

# Pristine state (delete every temporary database, token file, and dump):
rm -rf fixtures/swh-001/.tmp
```

Committed evidence is never regenerated in place from a run: the frozen dumps
are `docs/evidence/swh-001/served-state/`, produced by the seed + dump commands
above at commit `db3a121d3cbbc4beed1965ef6956b3294a109c7c`.
