# WCO-001 trace runbook — eligible two-human case

Prepared against shipped v1.17.0 (see `BASELINE_V1_17.md`). The rehearsal proved
the product mechanics but is not evidence (`REHEARSAL.md`). This runbook turns
them into an eligible case. Do not run this to "make the rubric pass": the case
must use **existing ordinary work** (contract §4.1).

## 0. Eligibility

- Two different people; two different agent harnesses; ordinary work.
- At least one human did not build the candidate change. The owner may
  participate but discloses their role and measurement knowledge.
- Record how the task arose and both participants' consent.
- Choose an **existing workspace** and a **real task that already exists** and
  already carries a blocker or unresolved dependency. Do not create or seed the
  task, finding, or decision for the case; do not point the case at a workspace
  whose records were prepared for it (contract §4.1: "do not seed a scenario
  into a user's workspace to make the rubric pass").
- If no eligible existing workspace and task are available, record the case
  **not observed** and stop; a rehearsal may continue separately and is not a
  result.

## 1. Access without creating the scenario

The workspace, Human A, and Agent A already exist in ordinary use. Only the
second pair is added, through the product's real membership path:

```bash
TRACE=<private recorder directory outside any user workspace>
mkdir -p "$TRACE/config-b"

# Owner issues an invitation on the existing instance (HTTPS for a real team;
# loopback HTTP only as the same-machine developer exception).
CAMPFIRE_CONFIG_DIR=<owner profile> CAMPFIRE_URL=<instance> CAMPFIRE_TOKEN=<A human token> \
  npx tsx src/cli/index.ts invite-teammate <ws> --out "$TRACE/b.invitation.json" --url <instance> [--allow-loopback]

# Human B joins with its own harness and profile
CAMPFIRE_CONFIG_DIR="$TRACE/config-b" \
  npx tsx src/cli/index.ts join --invitation-file "$TRACE/b.invitation.json" \
  --human-name "<B>" --harness <codex|opencode> --<harness>-config "$TRACE/config-b/<harness>.json" [--allow-loopback]
```

Connect each agent harness with **its own** agent token
(`CAMPFIRE_URL`/`CAMPFIRE_TOKEN`/`CAMPFIRE_HARNESS`); each agent registers its
own session (`register_agent_session`) before writing. Actor-bound Viewers may
be opened per human on distinct ports; verify each with `whoami`. Never copy one
actor's token, profile, or database to another, and never open the SQLite file a
running `serve` owns.

The case creates **no** goal, task, finding, decision, or artifact of its own.
B reads the existing task and its recorded dependency; every durable record of
the case is B's ordinary contribution to the existing work.

## 2. Freeze the key before B reads (recorder only)

Record the **existing** task id; workspace and memberships; current source
position (`orientationCursor` and repo commit); the known blocker; source record
ids; expected safety constraints (accepted/competing decisions, `needsReview`);
which facts are available to B in Campfire; and what outcome counts as useful
work including the keyed safe escalation. Do not give B this key, a prepared
summary, a private transcript, or the desired answer.

Capture in order (contract §6.1): A's contribution; B's first authorized read
and inspected record ids; B's stated interpretation and action; B's durable
contribution and provenance; A's fresh-process return, inspected records, and
dependent action; any unresolved blocker; later voluntary reuse if it occurs.
Preserve timestamps and source positions. Note every non-Campfire explanation
that changes the outcome as a confound.

## 3. Score

Use `SCORING_FORM.md`. Score the original run before discussing answers or
shipping a fix. A second reviewer independently checks C1, C3, C4, C5, and C6
against the frozen key; disagreements resolve against the pre-run key. A repair
gets a new dated case; never rescore the old one.

## 4. Stop and reset

Stop `serve` and any Viewers (SIGINT / `kill $(cat <pidfile>)`). The trace
database, tokens, and captures stay in the gitignored trace directory; copy only
sanitized records into the result. Never commit tokens, invitation files,
credentials, raw prompts, or transcripts.
