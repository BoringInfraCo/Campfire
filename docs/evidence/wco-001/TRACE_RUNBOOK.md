# WCO-001 trace runbook — eligible two-human case

Prepared against shipped v1.17.0 (see `BASELINE_V1_17.md`). The rehearsal proved
the mechanics below end-to-end (`REHEARSAL.md`); this runbook turns them into an
eligible case. Do not run this to "make the rubric pass": the case must be an
ordinary task with a real dependency (contract §4.1).

## 0. Eligibility

- Two different people; two different agent harnesses; ordinary work.
- At least one human did not build the candidate change. The owner may
  participate but discloses their role and measurement knowledge.
- Record how the task arose and both participants' consent.
- If the task or access cannot be inspected without retaining secrets, choose
  another task or record the case unavailable.

## 1. Isolate the run

```bash
ROOT=<checkout>; TRACE=$ROOT/.campfire/traces/wco-001-live-<date>
mkdir -p "$TRACE/config-a" "$TRACE/config-b"
unset CAMPFIRE_URL CAMPFIRE_TOKEN CAMPFIRE_ACTOR_ID CAMPFIRE_ACTOR_TYPE CAMPFIRE_SESSION_ID CAMPFIRE_HARNESS CAMPFIRE_DB
export CAMPFIRE_TELEMETRY=0
```

Use a fresh database and fresh profile directories. Never point at an existing
user workspace and never copy credentials between actors.

## 2. Enroll both pairs through the real path

```bash
# Human A + Agent A + workspace + goal (tokens print once; keep them private)
CAMPFIRE_CONFIG_DIR="$TRACE/config-a" CAMPFIRE_DB="$TRACE/run.db" \
  npx tsx src/cli/index.ts onboard --human-name "<A>" --agent-name "<Agent A>" \
  --harness <codex|opencode> --workspace-name "<team workspace>" --goal "<real goal>" --output json

# Single writer
CAMPFIRE_CONFIG_DIR="$TRACE/config-a" CAMPFIRE_DB="$TRACE/run.db" \
  npx tsx src/cli/index.ts serve --host 127.0.0.1 --port <api-port>

# Owner issues an invitation; Human B redeems it with its own harness
CAMPFIRE_CONFIG_DIR="$TRACE/config-a" CAMPFIRE_URL=http://127.0.0.1:<api-port> CAMPFIRE_TOKEN=<A human token> \
  npx tsx src/cli/index.ts invite-teammate <ws> --out "$TRACE/b.invitation.json" \
  --url http://127.0.0.1:<api-port> --allow-loopback   # loopback = same-machine developer exception only

CAMPFIRE_CONFIG_DIR="$TRACE/config-b" \
  npx tsx src/cli/index.ts join --invitation-file "$TRACE/b.invitation.json" \
  --human-name "<B>" --harness <codex|opencode> --<harness>-config "$TRACE/config-b/<harness>.json" --allow-loopback
```

Connect each agent harness with its own agent token
(`CAMPFIRE_URL`/`CAMPFIRE_TOKEN`/`CAMPFIRE_HARNESS`); each agent registers its
own session (`register_agent_session`) before writing. Two actor-bound Viewers
(one per human) may be opened on distinct loopback ports; verify each with
`whoami`.

## 3. Freeze the key before B reads (recorder only)

Record: task id; workspace and memberships; current source position
(`orientationCursor` and repo commit); the known blocker; source record ids;
expected safety constraints (accepted/competing decisions, `needsReview`);
which facts are available to B in Campfire; and what outcome counts as useful
work including the keyed safe escalation. Do not give B this key, a prepared
summary, a private transcript, or the desired answer.

Capture in order (contract §6.1): A's contribution; B's first authorized read
and inspected record ids; B's stated interpretation and action; B's durable
contribution and provenance; A's fresh-process return, inspected records, and
dependent action; any unresolved blocker; later voluntary reuse if it occurs.
Preserve timestamps and source positions. Note every non-Campfire explanation
that changes the outcome as a confound.

## 4. Score

Use `SCORING_FORM.md`. Score the original run before discussing answers or
shipping a fix. A second reviewer independently checks C1, C3, C4, C5, and C6
against the frozen key; disagreements resolve against the pre-run key. A repair
gets a new dated case; never rescore the old one.

## 5. Stop and reset

Stop `serve` and any Viewers (SIGINT / `kill $(cat <pidfile>)`). The trace
database, tokens, and captures stay in the gitignored trace directory; copy only
sanitized records into the result. Never commit tokens, invitation files,
credentials, raw prompts, or transcripts.
