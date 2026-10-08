# WOW-001 incident pilot packet

**Status (October 8, 2026):** Preregistration remains frozen. The six pilot
arms and six handoffs have been executed; independent scoring and the verdict
are pending in `docs/SPRINT_WOW_001_RESULT.md`. The scenario bundles,
keys, prompts, applicability matrix, rubric, and playbook version were committed
before the runs; the dated environment lock is `RUN-LOCK.md`; the sealed-key
isolation demonstration is `docs/evidence/wow-001/`. The contract is
`docs/Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md`. Do not treat these
synthetic runs as Gate B or Gate C evidence.

## File boundary

Each `S1`–`S3` bundle has `scenario.md` and `evidence/` for the first agent, plus
sealed `ground-truth.md` and `scoring-key.md` for scorers. S2 also has a sealed
`setup.md` to seed the same prior-shift false-lead finding in both arm workspaces
with honest fixture provenance; the first agent must not be induced to invent a
wrong claim merely to exercise correction. Copy only the assigned
scenario and evidence to a fresh run directory outside this repository. The
first agent may access that directory and its authorized Campfire workspace;
the second agent may access only its authorized Campfire workspace. Neither
agent may access this repository, the other arm, the scoring keys, the contract,
or prior run results. Demonstrate the filesystem/tool boundary before a run;
instructions alone do not establish isolation. If the boundary fails, mark the
run invalid and preserve the exposure in the result.

Use one fresh workspace and a fresh first-agent conversation for every arm.
Create the workspace and its actor memberships before the run; disclose the
workspace ID and the same operator-approved permissions to both arms. Do not
seed the answer or manually clean up the workspace. After the first agent stops,
save a read-only export and stream tip, then make no further writes until the
second agent has answered and the workspace has been scored.

## Frozen prompt text

Replace only `<workspace-id>`, `<scenario-path>`, and `<deadline>` with the
pre-recorded values. The control and treatment first-agent prompts differ by
exactly the one marked sentence. These prompts are run instructions, not files
placed in either agent's accessible working directory.

**First agent, both arms:**

> Investigate the incident described in `<scenario-path>/scenario.md` using
> only the evidence files in that scenario directory and your authorized
> Campfire workspace `<workspace-id>`. Record the useful, supported work in
> Campfire so another agent can continue without this conversation. Do not
> read outside your assigned directory or fetch any answer key. Stop when the
> investigation and record are complete or at `<deadline>`, whichever comes
> first. Report the Campfire object IDs you created or changed.

**Treatment-only added sentence:**

> Campfire's `incident-investigation` playbook is available through
> `get_playbook` or `campfire playbook incident-investigation` if useful.

**Second agent, both arms:**

> Use only the authorized Campfire workspace `<workspace-id>`; you have no
> scenario files or prior transcript. State what happened, what the team
> currently believes the cause is, what response is recorded and its actual
> decision status, the next action, and what remains uncertain or needs review.
> Cite the Campfire objects supporting your answer. Do not write to Campfire.

## Run lock to complete before the first pilot run

Record the exact first- and second-agent harness names, model versions, tool
allowlists, base-release commit, setup procedure, budgets, stop rule, and
isolation check in a dated committed addendum to this file before the first
pilot run. Record the implemented CLI/package commit and playbook version in
that addendum. Use the same lock in
both arms of a scenario. The first
agent's maximum is 30 elapsed minutes or 100 tool calls, and the second's is
10 elapsed minutes or 30 tool calls; the earlier limit stops the run. A run
stopped for an infrastructure failure is invalid, not a low-scoring response.
The committed arm order is:

| Scenario | First run | Second run |
| --- | --- | --- |
| S1 | Control | Treatment |
| S2 | Treatment | Control |
| S3 | Control | Treatment |

Use `CAMPFIRE_PLAYBOOK=1` only for a treatment first agent. Unset it and omit
`--with-playbook` for controls and all second agents. Reload each MCP harness,
record its tool list, and verify both CLI and MCP playbook access are disabled
in controls. The installed build is otherwise identical. Capture CLI and MCP
invocations in the pilot runner's local log; this is pilot evidence, not product
telemetry. Record every playbook exposure, including shell, manifest, copied
text, or source access.

## Frozen applicability and scoring

All items apply in both arms except R4, which applies only to S2, and C5,
which applies only to S3. The two arms of a scenario use the same denominator.

| Scenario | Recording items | Recording pass count | Continuation items | Continuation pass count |
| --- | ---: | ---: | ---: | ---: |
| S1 | 9 | 8 | 6 | 5 |
| S2 | 10 | 8 | 6 | 5 |
| S3 | 9 | 8 | 7 | 5 |

An evidence citation must identify an existing Campfire artifact and connect
it to the claim; a bare artifact title in prose does not count. `confidence`
must be present where required and must not present an unresolved hypothesis
as certain. Provenance requires a real acting identity and registered session
on contributions; a private transcript pasted into a finding fails R9. A
decision remains proposed unless the record shows explicit authorized approval;
the second agent must state that status accurately. Unsupported state means a
claim contradicted by the frozen workspace export or absent from it when the
answer asserts it as fact. Scenario-specific correct facts and acceptable
uncertainty are in sealed scoring keys.

Two independent scorers receive a blinded export and answer, plus the sealed
key. They score each binary item separately before discussing disagreements.
Record both initial score sheets and resolve each disagreement against the
frozen key; record the reason and final value. Compare normalized fractions
(`passed / applicable`) in matched pairs. Report the offer comparison across
all valid runs, fetch rate separately, and all invalid attempts. A treatment
run that never fetched the playbook remains in the offer comparison but cannot
be described as evidence that using the guidance helped.

One invalid arm may be repeated once with a fresh workspace and session under
the same prompt and lock. Preserve the invalid attempt. Any replacement caps
the verdict at CONDITIONAL GO. If a valid replacement cannot be obtained, no
GO verdict is possible. Do not replace a valid low score or change a scenario
or rubric after the first run.
