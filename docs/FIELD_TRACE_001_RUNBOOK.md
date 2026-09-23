# Campfire — Field Trace 001 Runbook

**Status:** Ready to run  
**Trace:** Field Trace 001 — Multi-day team use  
**Roadmap gates:** Gate B (repeat usage), Gate C (multi-participant value)  
**Substrate:** Stage B team-hosted SQLite/HTTP  

---

## 0. Purpose and non-goals

Field Trace 001 tests whether people voluntarily return to a persistent Campfire
workspace and whether another participant's contribution materially changes
later work during ordinary team use.

This is field evidence for Gates B and C. It is not Sprint 007, a scripted
acceptance run, or a claim that Stage C is complete. Its result selects one
narrow follow-up sprint from observed friction.

The trace uses:

- multiple actual humans;
- at least two distinct agent harnesses (Codex and OpenCode are the proven pair);
- one persistent team-hosted workspace;
- several naturally occurring sessions over multiple days;
- structured Campfire state, with private transcripts kept outside Campfire.

Claude Code may participate, but it is not a gate. Its outstanding live
validation remains separate from this trace.

### Non-goals

- new domain objects;
- durable read, entry-point, or authorization-log persistence;
- a Stage C hosted product;
- Workers/D1 validation;
- product analytics beyond export-and-analyze;
- Sprint 003 or Claude Code validation;
- choosing or starting the next implementation sprint.

No product code changes are part of this runbook.

---

## 1. Pre-Day 1 controls

All four controls are required before the first counted session.

### 1.1 Validate and commit the CLI JSON hardening

The trace depends on stable JSON output and exit behavior. From the repository
root, run:

```bash
npm run typecheck
npm test
npm run acceptance
npm run acceptance:002
git diff -- README.md src/cli/index.ts tests/unit/cli.test.ts
```

`npm run acceptance:002` exercises the real-harness path and may require the
configured Codex/OpenCode environment. Record any environmental failure
honestly; do not report a harness run that did not occur.

Review the complete diff. If it is correct and all required validation passes,
commit only the existing JSON-hardening files:

```bash
git add README.md src/cli/index.ts tests/unit/cli.test.ts
git commit -m "feat(cli): structured --json contract and error shape"
git status --short --branch
```

The working tree must be clean before Day 1. Record the resulting commit SHA in
the frozen configuration. Commit this runbook separately before starting the
trace. Do not combine the runbook or unrelated changes with the CLI hardening
commit.

### 1.2 Create the private evidence tree

`evidence/` is gitignored. Create the trace tree only after the CLI hardening
commit so the configuration can name the exact SHA being exercised:

```bash
mkdir -p evidence/field-trace-001/sessions
mkdir -p evidence/field-trace-001/analysis
touch evidence/field-trace-001/config.md
touch evidence/field-trace-001/server-stderr.log
```

Use this layout:

```text
evidence/field-trace-001/
├── config.md
├── server-stderr.log
├── sessions/
│   └── 2026-09-24T140000Z-alice-cli/
│       ├── session.md
│       ├── boundary-start.json
│       ├── activity-end-page-001.json
│       └── reads.md
└── analysis/
    ├── deltas.md
    ├── gate-b.md
    ├── gate-c.md
    └── friction.md
```

Add additional `activity-end-page-NNN.json` files when pagination is required.
Raw tokens and private transcripts must never enter this tree.

The only trace artifact intended to enter Git is the result document created
after the trace:

```text
docs/FIELD_TRACE_001_RESULT.md
```

### 1.3 Freeze trace configuration

Write `evidence/field-trace-001/config.md` before the first session:

```markdown
# Field Trace 001 — Frozen configuration

- Start date:
- Planned duration:
- Campfire commit SHA:
- package.json version:
- Host:
- Port:
- CAMPFIRE_URL:
- SQLite path:
- Workspace ID:
- Single writer: yes — the `campfire serve` process owns the SQLite file

## Participants

| Display name | Kind | Actor ID | Human principal | Harness | Workspace role | Token issued? |
| --- | --- | --- | --- | --- | --- | --- |
| | human/agent | | | | | yes/no |

## Harness environment shape

- Codex: CAMPFIRE_URL + actor-specific CAMPFIRE_TOKEN + CAMPFIRE_HARNESS=codex
- OpenCode: CAMPFIRE_URL + actor-specific CAMPFIRE_TOKEN + CAMPFIRE_HARNESS=opencode

Raw bearer tokens are deliberately omitted.
```

Record actor and token IDs only. Never record raw bearer tokens.

### 1.4 Start the Stage B host and capture stderr

Commands in this runbook use the frozen source checkout directly. From the
repository root, initialize the chosen database and start one writer process in
a dedicated terminal. `init` creates the schema; `bootstrap` creates the
organization, team, first human, and that human's initial token:

```bash
export CAMPFIRE_DB="/absolute/path/to/field-trace-001.db"
npx tsx src/cli/index.ts init --db "$CAMPFIRE_DB"
npx tsx src/cli/index.ts bootstrap --db "$CAMPFIRE_DB" \
  --org org_campfire --team team_engineering \
  --org-name "Campfire" --team-name "Engineering" \
  --human-name "Trace Owner"
npx tsx src/cli/index.ts serve --db "$CAMPFIRE_DB" --host 127.0.0.1 --port 9414 \
  2>> evidence/field-trace-001/server-stderr.log
```

`bootstrap --human-name` prints the first raw token once. Move it directly into
the owner's private environment or credential store. Do not redirect or copy
that output into the evidence tree.

If teammates connect from other machines, use a reachable host on a trusted
network or behind a secure tunnel/TLS proxy. Do not expose the bearer-token
HTTP endpoint over the public internet without transport security and network
controls.

The Viewer is separate. A non-loopback Viewer bind requires `--allow-remote`
and exposes the operator's read authority, so enable it only when the trace
actually requires it.

Capturing stderr is mandatory. If stderr is not captured, the session does not
count. Authorization allow/deny events and HTTP access records are otherwise
ephemeral.

Current stderr access and authorization records do not contain timestamps.
Bracket every session with explicit timestamped markers in the same file. Fill
the values rather than copying placeholders:

```bash
printf '%s\n' '{"event":"field_trace_marker","phase":"start","sessionId":"<session-id>","at":"<UTC-ISO-8601>"}' \
  >> evidence/field-trace-001/server-stderr.log
```

At session end, append the corresponding marker with `"phase":"end"`.

---

## 2. Provision the workspace and identities

Use the token/invite workflow in `docs/OPERATOR.md`. The first human bootstraps
the instance, creates the workspace, and invites every other human and agent.

In a shell configured for the acting actor:

```bash
export CAMPFIRE_URL="http://127.0.0.1:9414"
export CAMPFIRE_TOKEN="<actor-specific-token>"
```

Representative provisioning commands are:

```bash
npx tsx src/cli/index.ts create-human --name "Alice" --team team_engineering
npx tsx src/cli/index.ts create-agent --name "Codex" --human <human-id> --harness codex
npx tsx src/cli/index.ts create-agent --name "OpenCode" --human <human-id> --harness opencode
npx tsx src/cli/index.ts issue-token --actor <actor-id> --type human
npx tsx src/cli/index.ts issue-token --actor <actor-id> --type agent
npx tsx src/cli/index.ts create-workspace --team team_engineering --name <workspace-name>
npx tsx src/cli/index.ts invite <workspace-id> --actor <actor-id> --type human --role member
npx tsx src/cli/index.ts invite <workspace-id> --actor <actor-id> --type agent --role agent
```

Each invited actor joins using its own bearer token:

```bash
npx tsx src/cli/index.ts join <workspace-id>
```

Each harness process receives only its own token:

```jsonc
{
  "mcpServers": {
    "campfire": {
      "command": "npx",
      "args": ["tsx", "src/mcp/stdio.ts"],
      "env": {
        "CAMPFIRE_URL": "http://127.0.0.1:9414",
        "CAMPFIRE_TOKEN": "<agent-specific-token>",
        "CAMPFIRE_HARNESS": "codex-or-opencode"
      }
    }
  }
}
```

Record IDs and roles in `config.md`; do not record token values.

---

## 3. Session protocol

Use the session ID convention:

```text
YYYY-MM-DDTHHMMSSZ-<participant>-<surface>
```

Examples:

```text
2026-09-24T140000Z-alice-cli
2026-09-25T161500Z-codex-mcp
```

Every counted session follows this sequence:

1. Create the session directory and notes files.
2. Append the start marker to `server-stderr.log`.
3. Capture the activity boundary before the first Campfire interaction.
4. Perform natural work.
5. Log every read manually in `reads.md`.
6. Export all activity through session end.
7. Complete `session.md`.
8. Append the end marker to `server-stderr.log`.

### 3.1 Create a session directory

```bash
export TRACE_DIR="evidence/field-trace-001"
export TRACE_SESSION_ID="2026-09-24T140000Z-alice-cli"
export TRACE_SESSION_DIR="$TRACE_DIR/sessions/$TRACE_SESSION_ID"
export TRACE_WORKSPACE_ID="<workspace-id>"
mkdir -p "$TRACE_SESSION_DIR"
touch "$TRACE_SESSION_DIR/session.md"
touch "$TRACE_SESSION_DIR/reads.md"
```

### 3.2 Capture the start boundary

The boundary capture is the first Campfire request of the session. It must run
before the participant's first work-related Campfire read or write:

```bash
npx tsx src/cli/index.ts activity "$TRACE_WORKSPACE_ID" --limit 1 --json \
  > "$TRACE_SESSION_DIR/boundary-start.json"
```

`limit 1` returns the newest contribution in the ordered activity stream. Copy
its `items[0].id` into `session.md`. If `items` is empty, record a null boundary.

Contribution IDs have the form `con_<16 hex>` and are random. They are not
time-sortable strings. Ordering comes from `created_at, rowid` in the store.

### 3.3 Log reads manually

Reads are not persisted as contributions. For each read, append to `reads.md`:

```markdown
| UTC time | Surface/harness | Method | Why | State used |
| --- | --- | --- | --- | --- |
| | cli/mcp/view | get_workspace_context/show/activity/etc. | | |
```

Write `None` when a session performed no Campfire reads. Do not leave the file
ambiguous.

### 3.4 Export end activity and paginate fully

Start with the newest page:

```bash
npx tsx src/cli/index.ts activity "$TRACE_WORKSPACE_ID" --limit 1000 --json \
  > "$TRACE_SESSION_DIR/activity-end-page-001.json"
```

If the page has `truncated: true`, use its `nextBefore` value to fetch the next
older page:

```bash
npx tsx src/cli/index.ts activity "$TRACE_WORKSPACE_ID" --limit 1000 \
  --before <nextBefore> --json \
  > "$TRACE_SESSION_DIR/activity-end-page-002.json"
```

Repeat until the final page reports `truncated: false`.

Each page's `items` are ordered oldest-to-newest, but pagination returns the
newest page first. During analysis, prepend each subsequently fetched older
page to the accumulated list. Do not compare contribution IDs
lexicographically and do not append older pages after newer pages.

Find the start-boundary contribution in the reconstructed chronological list.
The interval delta is every contribution after that boundary through the end
export. If the start boundary is null, all exported items belong to the trace
up to that session's end; use prior session boundaries to avoid counting the
same contribution twice.

The interval delta may contain concurrent contributions from other actors.
Identify the session participant's own contributions by actor ID and, for an
agent, agent-session ID where available. Preserve concurrent contributions in
the interval record, but never attribute them to the session participant.

### 3.5 Complete the session record

Use this template in `session.md`:

```markdown
# Session — <label>

- Date/time (local + UTC):
- Participant:
- Entry point: cli | mcp | view | other — include harness for agents
- Boundary start contribution ID (or null):
- Reads performed: see reads.md
- State retrieved (orientation/show/context — summary):
- State contributed by this participant (filter interval delta by actor/session):
- Concurrent contributions observed in the interval:
- Cross-participant influence observed? Y/N
- If yes, which earlier contribution changed which later action?
- Manual explanation still required:
- Orientation/noise friction:
- Auth failures:
- Provenance oddities:
- Voluntary return? (meaningful only on day 2 or later):
- Private transcript shared? Must be No
- Boundary end / delta size:
```

The causal note for cross-participant influence must identify both the earlier
contribution and the later action. Chronological proximity alone is not proof
of influence.

---

## 4. Standing rules

- Private transcripts stay outside Campfire and are never forwarded between
  sessions or participants.
- Contribute durable structured state, not copied conversation history.
- Use multiple actual humans and at least two distinct harnesses.
- Run natural work sessions, not a scripted acceptance scenario.
- Make the boundary capture the session's first Campfire request, before any
  work-related read or write.
- Log reads manually because the database does not record retrievals.
- Capture server stderr for every counted session.
- Keep each actor's bearer token private and scoped to that actor.
- Do not copy the SQLite database between participants.
- Record failures and friction without repairing the evidence after the fact.

---

## 5. Analysis checklist

### Per session

- [ ] Start boundary exists, or an empty-start null is explicit.
- [ ] End activity is fully paginated through a page with `truncated: false`.
- [ ] Pages are reconstructed in chronological order.
- [ ] Interval delta contains only contributions after the boundary.
- [ ] Participant-authored contributions are filtered by actor/session identity.
- [ ] `reads.md` is filled or explicitly says `None`.
- [ ] `session.md` is complete.
- [ ] No raw bearer token is present in evidence.
- [ ] No private transcript was shared or stored.
- [ ] Start/end markers bracket the relevant stderr records.
- [ ] Auth and provenance anomalies are recorded rather than normalized away.

### Cross-session

- [ ] A human's later-day return is supported by session evidence.
- [ ] That return used Campfire state without a prepared handoff.
- [ ] A contribution-to-action causal link is documented for Gate C.
- [ ] Manual explanation is tallied.
- [ ] Authorization denials are tallied from notes and stderr.
- [ ] Provenance oddities are tallied.
- [ ] Orientation and noise failures are tallied.
- [ ] `friction.md` clusters observations without inventing unobserved needs.
- [ ] Exactly one narrow follow-up sprint is recommended.

Write per-session deltas to `analysis/deltas.md`, Gate B evidence to
`analysis/gate-b.md`, Gate C evidence to `analysis/gate-c.md`, and consolidated
friction to `analysis/friction.md`.

---

## 6. Evaluation rubric

Use this rubric verbatim in the runbook analysis and result document:

- **Gate B GO:** at least one human voluntarily returns on a later day and
  resumes using Campfire state without a prepared handoff.
- **Gate C GO:** another participant's contribution materially changes a later
  action, with the causal link documented.
- **Conditional:** useful continuation occurs, but requires significant manual
  explanation or produces orientation/noise/authentication friction.
- **No-GO/reframe:** participants do not return, or Campfire state does not
  materially improve subsequent work.

Report Gate B and Gate C separately before assigning one overall
recommendation. Do not upgrade controlled or diary-correlated evidence into a
claim of durable product telemetry.

---

## 7. Result document contract

After the multi-day trace, create `docs/FIELD_TRACE_001_RESULT.md` using the
structure of `docs/SPRINT_006_RESULT.md`:

```markdown
# Campfire — Field Trace 001 Result

**Status:** Complete
**Date:** YYYY-MM-DD
**Recommendation:** GO | CONDITIONAL GO | NO-GO / REFRAME

## 1. Result

## 2. Environment and participants

## 3. Evidence paths

## 4. Gate B verdict

## 5. Gate C verdict

## 6. Transcript isolation

## 7. Authorization and provenance observations

## 8. Manual explanation and orientation friction

## 9. Limitations

## 10. Recommended next sprint
```

The result must:

- distinguish direct database evidence, stderr evidence, and manually recorded
  diary correlation;
- state the Gate B and Gate C verdicts against the rubric;
- identify limitations honestly;
- list observed friction;
- recommend exactly one narrow next sprint;
- state that field evidence selected the recommendation;
- avoid naming the recommendation Sprint 007 until it is accepted as the next
  sprint contract.

The private `evidence/field-trace-001/` tree remains gitignored. The committed
result may reference evidence paths but must not copy raw tokens, private
transcripts, or sensitive log contents into Git.

---

## 8. Freeze-to-result sequence

| Step | Action | Exit artifact |
| --- | --- | --- |
| 1 | Validate and commit JSON hardening | Clean tree and frozen commit SHA |
| 2 | Create the private evidence tree | `evidence/field-trace-001/` |
| 3 | Freeze topology, identities, and workspace | `config.md` with IDs only |
| 4 | Run natural sessions over multiple days | Complete session evidence |
| 5 | Evaluate Gates B and C | Analysis files and rubric verdicts |
| 6 | Select one narrow follow-up | `docs/FIELD_TRACE_001_RESULT.md` |

Stop after the result and recommendation. Do not implement the recommended
sprint as part of Field Trace 001.
