# WOW-001 pilot result — GO on frozen synthetic pilot

**Date:** October 8, 2026
**Status:** Six preregistered arms and six second-agent handoffs executed;
two independent blind scorers completed all item scores. The audited pilot
verdict is **GO** under the frozen rubric. This supports the bounded v1.13
playbook release decision; it is not Gate B, Gate C, or a claim of ordinary
team value.

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

## 3. Independent scoring and source audit

The frozen rubric requires two scorers to score each item independently,
blind to arm where feasible, then resolve disagreements against the sealed
key. Arm-blind packets were staged outside the repository with only the
workspace export, second-agent answer, first-agent/fixture attribution,
rubric, and scenario scoring key. The arm mapping and model credentials are
outside the mounted packet.

The first attempted external scorer launch was rejected by automatic approval
review **before any scorer container started or packet was sent** because that
specific transfer had not yet been authorized. On October 8 the repository
owner explicitly approved sending these synthetic, arm-blind packets to
`opencode-go/glm-5.3` and `opencode-go/kimi-k3`. The packets did not contain
credentials, customer data, arm mapping, or a first-agent transcript. Kimi
returned six complete sheets. GLM returned complete item coverage through
smaller fresh-session groups after four no-score output-limit attempts. These
attempts are recorded separately from the six valid pilot arms in
`docs/evidence/wow-001/scoring/manifest.json`.

Both scorers' unmodified initial per-item judgments and reasons are retained
in `docs/evidence/wow-001/scoring/P*-{glm,kimi}.json`. Five of six packet
pairs had identical item judgments; P1 R10 differed.
The source audit resolved that disagreement against the frozen S2 key and
corrected three items both scorers over-credited. The corrections are
reproducible in `scripts/wow-001/resolve-scores.mjs` and explained with exact
object IDs in `scoring/resolved.json`:

| Packet | Item | Resolved | Frozen-key reason |
| --- | --- | :---: | --- |
| P1, S2 control | R6 | Fail | The sole decision-basis finding has no formal link to evidence 01, 05, or 06. |
| P1, S2 control | R10 | Fail | The asserted cause names files in prose but has no artifact-backed citation. |
| P2, S3 control | R5 | Fail | The inconclusive finding flags missing traces but leaves the discriminating collection plan to a decision and task. |
| P3, S1 control | R8 | Fail | Open tasks seek approval and monitor the pause; none records authorized remediation and verification after it. |

The earlier unblinded operator sheet at
`docs/evidence/wow-001/score-operator-initial.md` remains a provisional
initial judgment, not a third blind scorer. It under-credited several valid
`source_artifact_id` citations and decision-basis links in treatment records.
It also identified the four source-audit items above. The treatment S1 R3
finding is a borderline wording call: it says “Most likely cause” and
“Inference,” includes confidence and Confirm/Refute tests, and notes its
unconfirmed basis. Both blind scorers passed it; that is accepted under the
frozen key and documented in the scoring README. Failing it would not change
the pilot GO calculation.

## 4. Resolved scores and pilot verdict

The frozen thresholds are 8/9 recording for S1 and S3, 8/10 for S2,
5/6 continuation for S1 and S2, and 5/7 continuation for S3. N/A items were
excluded identically in matched arms.

| Scenario | Control recording | Treatment recording | Control continuation | Treatment continuation | Matched gain |
| --- | ---: | ---: | ---: | ---: | --- |
| S1 | 7/9 | 9/9 | 6/6 | 6/6 | Recording +2/9; continuation equal |
| S2 | 4/10 | 9/10 | 6/6 | 6/6 | Recording +5/10; continuation equal |
| S3 | 7/9 | 9/9 | 7/7 | 7/7 | Recording +2/9; continuation equal |

All **3/3 treatment runs** pass both dimensions. All **3/3 matched pairs**
are no worse on either normalized dimension and strictly better on recording.
Treatment fetched the playbook **3/3** times; control fetched it **0/3**.
Every treatment R9 provenance and C7 unsupported-state item passed. There was
no recorded authorization breach, answer-key exposure, replacement run, or
harness/model mismatch. The four preregistered expansion conditions are met:
**WOW-001 pilot verdict GO**. The computation and all resolved item booleans
are in `scoring/resolved.json`.

The second-agent continuation score is at its ceiling in both arms; this pilot
shows no measured continuation gain. The measured effect is better structured
recording on these three synthetic incidents. GLM's groupwise scoring is a
scorer-execution deviation from an ideal one-call sheet, with the same model,
evidence, and frozen rubric in every group. It was not a pilot-run replacement.
The six runs share one harness/model, one operator machine, and synthetic
fixture identities. They do not establish repeat usage, multi-participant
value, statistical significance, real-user comprehension, or production
readiness.

## 5. Release and gate decision

The owner authorized finishing the v1.13 release after the independent scoring.
The GO verdict supports publishing the single, opt-in `incident-investigation`
playbook and its CLI/MCP read surfaces as v1.13.0. The contract itself did not
authorize production promotion; this owner instruction supplies the separate
release authorization. The playbook remains disabled by default and versioned
1.0.0. No second playbook, workflow execution, Viewer change, new domain
object, or Gate B/C promotion is part of this release.

The publication record, checksums, install-channel pins, deployment, and live
verification will be added after those actions complete. Until then, pilot GO
is the only finalized verdict here.

The v1.13.0 candidate passed `npm ci`, typecheck, build, Darwin ARM64
packaging, and the Worker deployment dry run. The pre-pin test suite passed
**905 tests across 75 files**. The four install-channel tests had three passes
and the expected package-version assertion failure while the formula and flake
still point at v1.12.0; that assertion must pass after actual v1.13 archive
checksums are published and pinned. One earlier broad test attempt timed out in
the installer fallback case; the isolated test passed, and the complete
pre-pin rerun passed. The first sandboxed test attempt also timed out while a
loopback fixture tried to bind; the accepted suite was run with local test
networking available.

A read-only `npm audit --omit=dev` on the locked dependencies reported four
production-tree advisories (one critical, one high, two moderate) already
present through `@modelcontextprotocol/sdk@1.30.0` in the v1.12 lock. The
critical [`proxy-addr` issue](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
requires Express trust-proxy subnet configuration;
Campfire's MCP server and acceptance client use stdio, and no Campfire source
imports Express. The SDK high-severity advisory concerns an OAuth HTTP client;
the [upstream advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h)
explicitly excludes stdio clients and SDK servers. No exercised path for
either issue was identified in this v1.13 slice. The dependency refresh is a
separate follow-up; the pilot-locked runtime dependency tree is unchanged.
