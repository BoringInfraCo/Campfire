# Decision-set recheck — unscored recipient diagnostic

**This is not a pilot. It produces no verdict.** It is an unscored behavioural
diagnostic asking one question: does a fresh offline recipient handed the
**corrected** handoff packet still lift a superseded decision's rationale into a
live condition?

The October 12 local run and its limits are recorded in `RESULT.md`. The five
automated checks are diagnostic aids, not a scored rubric; the first check
missed a correct paraphrase in that run and its generated detail is false.

It is not RCL-003. It does not rescore, rerun, or reopen RCL-001, RCL-002, or
RCL-003. It writes nothing into `~/.campfire-pilot/rcl-003/`. Its output root is
`~/.campfire-pilot/decision-set-recheck`, outside the repository and outside the
RCL-003 pilot root.

## Why it exists

`docs/SPRINT_RCL_003_RESULT.md` records a NO-GO in which the S2 offline recipient
promoted a condition that existed only in a superseded predecessor's rationale,
writing that the 02:00 job must stay disabled "per both rationales". The result
doc names the root cause as a projection defect: `handoffDecisionSetMembers`
flattened every set member's `section` to `"decision-set"`, erasing the
`historical`/`current` split the same packet already carried in `records[]`.

That defect was corrected at `4312278`. The correction has been verified
deterministically and by packet replay. **No fresh recipient run had confirmed
that it changes recipient behaviour.** This is that run.

## Running it

```
npx tsx fixtures/recall/decision-set-recheck/diagnose.ts
```

Typecheck:

```
./node_modules/.bin/tsc -p fixtures/recall/decision-set-recheck/tsconfig.json
```

The recipient budget is 10 minutes, the RCL-003 recipient budget. Exit code 0
means *the diagnostic ran and recorded an answer*. It does **not** mean the
correction worked: a failing check is the measurement and still exits 0. Exit 1
means the diagnostic could not measure anything (harness unavailable, fixture
precondition broken, isolation hole, empty answer).

## What it does

1. Seeds a workspace through the real `createCampfireService`, mirroring the
   RCL-003 S2 shape: an accepted predecessor whose **summary** is a release rule
   and whose **rationale** carries a precondition-style clause that reads like a
   live condition; an accepted replacement created through the real
   `addDecision({ replacesDecisionId })` + `acceptDecision(ctx, id, { reason })`
   path; and a proposed decoy that matches the query but is not a release rule.
2. Projects the packet with the real service's `projectHandoffPacket`, writes it
   to the arm directory at mode `0600`, then deletes the database, the token,
   and the `-wal`/`-shm` files exactly as `rcl-002/diagnose.ts` does. Asserts
   the packet carries no `cft_` string and no local path.
3. Spawns a **fresh** OpenCode process (`2.0.26`, model `opencode-go/glm-5.2#max`
   — the RCL-003 recipient harness and model) under `sandbox-exec`, in a working
   directory holding only `packet.json`, a `prompt.txt`, and a locked-down
   `opencode.json`. No Campfire credential, no database, no checkout access.
4. Records the answer and the five checks below, pass or fail.

Fixture preconditions are asserted loudly before the recipient starts: the set is
`linked-accepted-decisions`, the operative id is the replacement, the superseded
member is `section: "historical"` with **no** `rationale` and a
`historicalExplanation`, the operative member is `section: "current"` and keeps
its own rationale, the proposal is `section: "current"` with lifecycle
`proposed`, the trap clause appears nowhere inside `decisionSet`, and neither
keyed decision leaked into the accepted anchors.

## The five checks

Declared in `diagnose.ts` before the run. They are recorded, not enforced: a
failing check is a result.

1. **The superseded precondition is not stated as a live condition.** The
   decisive check, mirroring the RCL-003 failure sentence. A sentence carrying
   the clause passes only if it also frames it as historical *and* does not ask
   for progress toward it — tracking a condition is applying it however it is
   labelled.
2. **The accepted replacement is named as the operative rule.**
3. **No retirement, review, or replacement is requested** when one is already
   recorded.
4. **The proposed decoy is not promoted** into a rule. Mentioning it as an
   unaccepted proposal is not promotion.
5. **At least one keyed decision id is cited.**

## Isolation

Follows `rcl-002/isolation.md` and the RCL-003 runner's profile approach:

- Both path spellings of every denied path, reads **and** writes. RCL-002's
  first write rule covered only the original spelling.
- The whole checkout is denied, plus `.git` explicitly. The RCL-002 hole — a
  readable `.git` lets `git show HEAD:fixtures/.../ground-truth.md` read the
  committed answer key — is probed directly against the committed RCL-002 and
  RCL-003 keys, and only after confirming out-of-sandbox that those keys really
  are in the object store. A denial proved against a missing key proves nothing.
- All three prior pilot roots (`rcl-001`, `rcl-002`, `rcl-003`) are denied for
  reads and writes; they hold prior packets, answers, and event streams.
- Host OpenCode config/data/state and host Codex history, auth, and memories are
  denied. The recipient gets an **isolated** OpenCode data directory that copies
  only authentication files and allowlisted routing rows from a freshly created
  SQLite schema; session and message tables are asserted empty. The host
  database is never backed up or `VACUUM INTO`-ed.
- `CAMPFIRE_*`, `GIT_*`, `OLDPWD`, `INIT_CWD` are unset. `HOME` and every `XDG_*`
  path are redirected into the arm's private directory. `PWD` is set to the arm
  directory, because OpenCode follows it and the parent shell's `PWD` is the
  checkout.
- The recipient's own `packet.json` is asserted readable.

The preflight runs every denial with a real read under the real profile before
the recipient starts, and aborts on any hole.

## Output

All under `~/.campfire-pilot/decision-set-recheck/`, mode `0600`:

| File | Contents |
| --- | --- |
| `result.json` | The five checks with evidence, exit code, answer bytes, packet facts, isolation report |
| `answer.txt` | The verbatim recipient answer |
| `tool-calls.json` | Every raw tool call with input, output, and status |
| `events.jsonl` | The raw OpenCode event stream |
| `inspect/decision-set.json` | The projected decision set, for reading |
| `inspect/seed-facts.json` | The seeded ids and the trap clause |

## Discipline

- Unscored. No verdict, no arm ordering, no budget comparison, no rescore.
- Nothing under `src/`, `tests/`, `docs/`, or any `rcl-00*` fixture tree is
  edited by this diagnostic. It only reads.
- Not added to `scripts/export-public-release.mjs`.
- No hash is pinned and no run lock is written. This is a diagnostic, not a
  frozen run; it is re-runnable.
- Nothing here is tuned to make the recipient behave correctly. If a recipient
  promotes the superseded clause, that is a finding to report, not a check to
  edit.
