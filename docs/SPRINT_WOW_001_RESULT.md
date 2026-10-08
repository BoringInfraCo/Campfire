# WOW-001 pilot result — execution record (scoring pending)

**Date:** October 8, 2026
**Status:** Six preregistered arms and six second-agent handoffs executed; the
two independent score sheets and final verdict are pending. This document is
an execution record, not a GO claim or v1.13 release decision.

## 0. Scope and frozen setup

The playbook definition remains `incident-investigation` 1.0.0 from
`977c0e3`. The harness/model lock is OpenCode 1.18.35 and
`opencode-go/deepseek-v4.1-flash` for both roles, with image ID
`sha256:349b90635fd4b584599aba5e01f989f44c38689f857eb217b1fbcb3fc078943a`.
The scenario bundles, prompts, applicability, thresholds, and arm order in
`fixtures/incidents/wow-001/` were not changed after the first run.
Pre-run tooling checks and the later repeatable preparation path are recorded
in `RUN-LOCK.md` and `docs/evidence/wow-001/`.

Each first agent received a fresh Campfire workspace, its assigned staged
`scenario.md` and `evidence/` files, and its own token. S2 received the same
prior-shift fixture in each arm with its separate agent/session attribution.
Every first-agent run passed `probe-fs` and `probe-gates` before the scored
agent started. The first-agent files were confined to `/run`; none of the
recorded file-tool arguments targeted a path outside `/run`. No scored first
or second agent used bash, edit, or web tools. The second agents received
distinct identities, a copy of the frozen workspace database, no `/run`
mount, no playbook flag, and the neutral continuation prompt.

## 1. Run execution

All six arms followed the preregistered order. `stopReason` was `completed`
and the streamed tool count equaled the session database count for every
first and second agent. All were below the 100-call/30-minute first-agent
and 30-call/10-minute second-agent limits. There were no invalid or replacement
runs and no recorded answer-key or control-playbook exposure. These are runner
validity observations, not rubric scores.

| Order | Run | First calls | Frozen stream tip | Second calls | Playbook fetches |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | S1 control | 41 | 37 | 2 | 0 |
| 2 | S1 treatment | 43 | 36 | 4 | 1 |
| 3 | S2 treatment | 43 | 39 | 5 | 1 |
| 4 | S2 control | 26 | 25 | 2 | 0 |
| 5 | S3 control | 39 | 34 | 3 | 0 |
| 6 | S3 treatment | 46 | 37 | 2 | 1 |

The observed fetch rate was 3/3 for offered treatment arms and 0/3 for
controls. The fetch criterion in the frozen rubric is therefore met. Fetching
does not show that an agent followed the guidance or improved the record.

## 2. Preserved evidence and limits

`docs/evidence/wow-001/runs/<run-id>/` holds, for each run:

- `receipt.json`: harness/image identity, run validity, tool counts, fetch
  count, setup and frozen stream tips, and a staged-manifest hash.
- `workspace.json`: a read-only whitelist export of the frozen workspace's
  goals, sessions, contributions, findings, transitions, citations, decisions,
  tasks, and artifacts. It excludes token, invitation, and auth tables.
- `first-answer.md` and `second-answer.md`: verbatim model text events;
  `first.log` and `second.log`: sanitized runner transcripts.

The six exports and logs were checked for `cft_`, `sk-`, bearer-token shapes,
the absolute operator home, and the repository path: zero matches. Raw
databases, tokens, OpenCode auth, and full JSONL remain outside the repository
under the private pilot root. Do not commit those raw files. The retained
synthetic run evidence cannot establish ordinary multi-user usage, Gate B,
Gate C, or Viewer comprehension.

The second agents made only Campfire read calls; none registered a Campfire
agent session or wrote incident state. They ran in fresh OpenCode sessions
under distinct Campfire agent identities. This distinction is recorded for
provenance review and does not change the frozen first-agent R9 criterion.

## 3. Scoring state

The frozen rubric requires two scorers to score each item independently,
blind to arm where feasible, then resolve disagreements against the sealed
key. Arm-blind packets were staged outside the repository with only the
workspace export, second-agent answer, first-agent/fixture attribution,
rubric, and scenario scoring key. The arm mapping and model credentials are
outside the mounted packet.

The first attempted external scorer launch was rejected by the automatic
approval review **before any scorer container started or packet was sent**.
The stated reason was that sending the workspace export and answer to
`opencode-go/glm-5.3` with a mounted credential lacked authorization for that
specific payload and destination. The proposed second scorer was
`opencode-go/kimi-k3`; it was not launched. A user approval request is pending.
No scoring attempt is being disguised as an invalid pilot arm.

The required independent per-item score sheets, disagreement resolutions, normalized matched
pairs, treatment pass count, and GO / CONDITIONAL GO / NO-GO verdict remain
unrecorded. One unblinded operator initial sheet is retained as
`docs/evidence/wow-001/score-operator-initial.md`; it is provisional and
cannot satisfy the independent-scoring requirement. The fetch criterion alone
cannot determine the result. The interim evidence shows both useful records
and citation gaps; their rubric effect must be resolved against the frozen
keys rather than inferred from record length or fetch count.

## 4. Release and gate decision

**No v1.13 release or playbook expansion decision yet.** Finish the two
independent scores, resolve disagreements, and apply all four preregistered
expansion criteria before changing this status. This pilot does not claim
Gate B or Gate C regardless of the eventual score.
