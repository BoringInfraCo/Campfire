# Campfire — Sprint COR-001 Result: Correct the Record

**Status:** Release source for package `1.11.0`. CONDITIONAL GO. Production is not deployed. The public snapshot is recorded after this commit and does not move the tag.

**Decision:** CONDITIONAL GO. This is not a full GO. The trace used one operator, one machine, and fixture participants.

**Date:** October 3, 2026

**Package version:** `1.11.0`

**Contract:** `docs/Campfire-v1.11-COR-001-Correct-the-Record.md`

## 1. Outcome and evidence boundary

A cold participant can see the current finding and the accepted decision, open the superseded records, and choose a next action that leaves the obsolete workaround alone. Correction writes a new finding. Withdrawal and retirement record a reason. The old summary, detail, evidence, and provenance stay on the old row.

The product trace is one operator on one machine. Ada and Grace are fixture identities created by that operator. Codex and OpenCode each ran a cold read and a catch-up read against a loopback server. There was no independent second human and no shared instance. Gate B and Gate C remain unmeasured. This verdict does not claim team value, repeat use, or a release journey.

## 2. What landed

| Surface | Behavior |
| --- | --- |
| Findings | `currentness` is `current`, `superseded`, or `withdrawn`. Existing rows migrate to `current`. Supersede creates a new finding in the same workspace with its own id and provenance. The old text stays. A reason is required. Withdrawal records a reason and no successor. |
| Decisions | Status stays `proposed`, `accepted`, or `superseded`. `addDecision` may name one accepted predecessor. Acceptance of that successor supersedes the predecessor in the same transaction, with a required reason. Retire supersedes an accepted decision, or rejects a proposed one, with a reason and no successor. Several proposals may cite one accepted decision. Acceptance claims the single successor. |
| Evidence | A finding may `supports` or `contradicts` an artifact in the same workspace. A decision may cite a finding as basis. `sourceArtifactId` remains. Notes are optional and short. Removal is by the stable evidence or citation id. |
| Reads | Orientation lists current findings and accepted plus proposed decisions. `historicalCounts` reports superseded and withdrawn findings, and superseded decisions, outside the current-item budget. `needsReview` is computed when a non-superseded decision cites a finding that is no longer current. Get-by-id still returns historical rows. Catch-up emits `finding.corrected`, `finding.withdrawn`, `decision.superseded`, and `decision.rejected` as their own change types and keeps the v1.10 frozen tip. |
| Interfaces | CLI: `correct-finding`, `withdraw-finding`, `cite-evidence`, `uncite-evidence`, `cite-basis`, `uncite-basis`, `retire-decision`, `add-decision --replaces`, `accept-decision --reason`, `findings --currentness`. MCP and HTTP use the matching service methods. The Viewer can display currentness and still has no write path. |
| Schema | SQLite schema version 7. D1 migration `migrations/0006_correct_the_record.sql`. Backfill sets `currentness` to `current` and invents no correction actor or reason. |
| Webhooks | The closed vocabulary is unchanged. `correctFinding` does not emit `finding.recorded`. Withdrawal, retirement, and predecessor supersession emit no webhook event. Accepting a replacement may emit `decision.accepted` only for the new decision. |

SQLite and the D1 service share the correction SQL and mappers. A unique claim on the predecessor is what makes one successor win. A losing concurrent accept returns `Conflict` and leaves the losing proposal `proposed`.

### Authorization shape

A correction or removal addressed by an object id returns `FindingNotFound`, `DecisionNotFound`, or `Conflict` ("Finding evidence was not found" / "Decision citation was not found") when the caller is not a participant. Those messages carry the id the caller already sent. They do not carry the workspace id, the note, or the reason. A viewer who is a participant still receives `Unauthorized`. An agent participant without a registered session still receives `Unauthorized`. A named workspace read such as `get_workspace_context` still returns `ParticipantRequired` for the workspace id the caller supplied.

## 3. Product trace

Disposable database `/tmp/cf-cor001-gate/data/gate.db`. Loopback `http://127.0.0.1:19531`, started from this working tree with `campfire serve`. Node.js 22.23.2. Codex CLI 0.150.1. OpenCode 1.18.34.

Harbor workspace `ws_e844657c1dcc4e5a` ("Harbor incident", goal "Restore a trustworthy March export") held enough rows to truncate orientation: findings 15 total / 10 returned, decisions 13/10, tasks 22/20, artifacts 14/10, blockers 0/0, recent changes 93/20, `historicalCounts` findings 1 and decisions 1, `fullHistoryIncluded` false. The post-correction stream tip was position 93. The saved pre-correction cursor was position 87.

Fixture humans: Ada (`hum_ada`) recorded the original finding and accepted the original decision. Grace (`hum_grace`) recorded the correction and accepted the replacement. Both agents belong to Ada and are Harbor participants. Neither agent had a registered session; these traces only read. Vault workspace `ws_6be7cb2aad9a4560` belongs to Ada and not to the agents. Its sentinel text did not appear in any harness log or final answer.

| Record | Id | State after the fixture |
| --- | --- | --- |
| Old finding | `find_d64c878a8016415a` | superseded; summary "The March export dropped rows because the tide table was stale"; evidence `supports` `art_5be976cd6ffc4b8c` |
| Current finding | `find_bc006e9c442a4f1a` | current; summary "The March export dropped rows because the export window overlapped a reload"; predecessor is the old finding; evidence `contradicts` `art_910e459787544b85` (`fev_339bb2cbc0d146a3`); reason "The tide table was current. The export overlapped the cache reload."; corrected by Grace at 2026-10-03T23:48:43.442Z |
| Old decision | `dec_c18f99134e0a41db` | superseded; "Flush the harbor cache before the next export" |
| Current decision | `dec_f9bd16ad4d8f44e6` | accepted; "Skip the cache flush and rerun the export after the reload window"; cites the current finding (`cit_40101fbc49db46a3`); reason "The cache flush would repeat the obsolete workaround." |
| Next task | `task_235f9612e64c4b20` | "Reload the March export" |

The cold prompt named neither the corrected conclusion nor the vault contents. The catch-up prompt supplied the workspace id and the saved cursor, and told the agent to skip `get_workspace` and `get_workspace_context`. Isolated Codex used a temporary `CODEX_HOME` with only the Campfire MCP server, `approval_policy` never, and tool approval set to approve. The account default model ran. The live `~/.codex` config was left unchanged. OpenCode used a temporary config that pointed MCP at the loopback URL and the agent token.

### Cold Codex

Exit 0 on the third process start, about 65 seconds. Tools, in order: `list_workspaces`; `get_workspace_context` on Harbor twice; `get_finding` for the old finding, then the new finding; `get_decision` for the old decision, then the new decision; `get_workspace_context` on the vault three times. Each vault call failed with `ParticipantRequired` for actor `agt_733f93f0ff09430a` and workspace `ws_6be7cb2aad9a4560`.

The final answer named Harbor only, the current finding and predecessor `find_d64c878a8016415a`, Grace's reason, old evidence `supports` and new evidence `contradicts`, the accepted replacement decision and the superseded flush, and the next action "rerun the March export after the reload window, without flushing the cache." It reported the orientation totals above as truncated, and the vault error name `ParticipantRequired`.

Two earlier Codex starts failed before any Campfire read. The first isolated home had no `auth.json` and the API returned 401. The second set model `gpt-6-sol`, which this ChatGPT account rejected. The successful home copied auth into the isolated directory and omitted the model lines.

### Cold OpenCode

Log span 30.4 seconds, exit 0. Actor `agt_cce432a8b91341f9`. Tools: `whoami`, `list_workspaces`, `preflight` on the vault (error), `get_workspace_context` on Harbor, `get_finding` twice, `get_decision` twice, `list_tasks`, then `get_workspace_context` on the vault (error). No writes.

The final answer named the current finding `find_bc006e9c442a4f1a` and predecessor `find_d64c878a8016415a`, Grace at 2026-10-03T23:48:43.442Z, `supports` versus `contradicts`, accepted decision `dec_f9bd16ad4d8f44e6` replacing `dec_c18f99134e0a41db`, and next action `task_235f9612e64c4b20` with no cache flush. It printed the truncation table above. The vault error was `ParticipantRequired`. It also noticed the still-proposed chalkboard decision `dec_4798a7cd9c314b29`.

### Catch-up Codex

Exit 0 in 36.01 seconds. Tools: `get_workspace_changes`, then `get_finding` for both ids and `get_decision` for both ids. It did not call `get_workspace` or `get_workspace_context`.

The final answer named old finding `find_d64c878a8016415a`, new finding `find_bc006e9c442a4f1a`, the superseded flush, the accepted successor, and a next action that reruns the export and skips the cache flush. It restated the current finding as the export window overlapping a cache reload and restated the reason in its own words after reading the finding rows.

### Catch-up OpenCode

Log span 6.4 seconds, exit 0. The only tool was `campfire_get_workspace_changes`. It did not call `get_workspace` or `get_workspace_context`.

It named both finding ids, successor decision `dec_f9bd16ad4d8f44e6` with the correct accepted summary, predecessor decision `dec_c18f99134e0a41db`, and a next action that drops the cache flush. It labeled the corrected finding with the correction reason, "The tide table was current. The export overlapped the cache reload.", and labeled the old decision with the supersede reason. The change stream's compact label is the reason. A catch-up-only reader can treat that label as the object title. The ids and the safe next action were still right.

## 4. Engineering validation

Node.js 22.23.2. The first full suite and the first tarball ran while the package still said `1.10.0`: 70 files, 826 tests, archive sha256 `2d1ddebec029d2f202d012755014561dd8753c46d7d85764cfb8d85e7d2adaed`, installer `public/campfire/v1.10.0/install.sh`. Release preparation set the package to `1.11.0`. A review of that tree found three gaps, and the candidate below includes the fixes: human CLI output reads `correctionReason` and `supersedeReason`, the Viewer shows `needsReview` with the cited finding ids, and a D1 delete that matches no row fails the batch so the removal contribution does not commit.

| Step | Command | Result |
| --- | --- | --- |
| Build, including typecheck | `npm run build` inside `npm run pack:tarball` | exit 0, `campfire@1.11.0` |
| Full suite | `npm test` | 70 files, 827 tests, exit 0 |
| Package | `npm run pack:tarball` | `release/campfire-darwin-arm64.tar.gz`, sha256 `3ec41b8fa63ddd3ae3ed3850e80b3f8aa3634b56d8344aaccfd8053eefcb7924`, installer `public/campfire/v1.11.0/install.sh` identical to `public/campfire/install.sh`. The archive `package.json` says `1.11.0` and stays `private`. |
| Whitespace | `git diff --check` | clean |
| Remote | `git fetch origin main` | local `main` and `origin/main` are both `d800f9a23de44143e9b83c977cdd42f6f46415e1` |
| Export | `npm run export:public -- --ref v1.11.0` | runs after this commit is tagged. The later promotion note records the manifest. |

`tests/unit/cor-001.test.ts` covers correction and withdrawal, one-step links, list filters and stable cursors, `historicalCounts`, replacement acceptance, a second proposal, a simulated race that returns `Conflict`, retire and reject, `needsReview` cleared from the current projection by an explicit retire, the frozen catch-up tip, inaccessible-id errors, cross-workspace citation, reason and note limits, the closed webhook sequence, an injected claim failure that rolls back the finding, evidence, contributions, and domain events, a predecessor cycle on file-backed SQLite, and a clean D1 store through `migrateD1` plus the async service. Migration tests cover an upgraded SQLite store at schema version 7 and parity of `migrations/0006_correct_the_record.sql` with the shared v7 SQL. A clean new SQLite store takes the same migration.

The pack script printed a `gh release create` hint. No release was created.

## 5. Deviations

- This commit is the `1.11.0` release source. The verdict stays CONDITIONAL GO. Production is not deployed.
- A non-participant who already knows an object id gets `FindingNotFound`, `DecisionNotFound`, or a generic `Conflict`. Named workspace reads still use `ParticipantRequired`.
- Evidence and citation removal is by stable row id.
- `needsReview` is computed at read time and is not stored.
- Correction, withdrawal, retirement, and predecessor supersession add no webhook event types.
- OpenCode catch-up quoted the correction reason as the finding text and the supersede reason as the old decision text, because it read only the change stream.
- Codex catch-up paraphrased the current finding and the reason after reading the finding rows. The ids matched the store.
- The first two Codex starts failed on isolated-home auth and on model `gpt-6-sol`. The user's Codex config was not edited. The successful run used the account default model.

## 6. Not established

Gate B and Gate C remain unmeasured. The trace used fixture humans, one operator, and one machine. Both local harnesses passed. No second person participated, and no second machine or shared deployment was used. Viewer writes, embeddings, playbooks, generated views, and webhook vocabulary expansion stayed out of this sprint.

## 7. Independent local rerun

On October 3, 2026, a second verification used a newly created disposable
database and different facts from the Harbor gate. The fixture was "Beacon
deployment" (`ws_a87106e6b6654aa5`), with Maya and Noah as fixture humans and
fresh Codex/OpenCode agent identities. Its original finding said the gateway
certificate had expired. The corrected finding
`find_a1e22a134df64174` records that a device clock was 47 minutes ahead and
links back to superseded finding `find_ed23fd6e35214b73`. Accepted decision
`dec_561a76a959de4c25` says to synchronize device time and retry without
rotating the certificate; it supersedes `dec_6fa532faee184ee6`.

A deterministic verifier used the agent credential through the real loopback
HTTP boundary. It passed these checks:

- orientation returned only the current finding and accepted replacement
  decision, with historical counts of one finding and one decision;
- findings were 10/12, decisions 10/11, and tasks 20/22, each explicitly
  truncated;
- drill-down preserved both predecessor/successor links, the contradiction
  evidence, the decision citation, and the reasons;
- catch-up from the pre-correction cursor included `finding.corrected` and
  `decision.superseded`;
- the unrelated workspace returned HTTP 403 `ParticipantRequired`, and its
  sentinel content was absent from the response;
- the real Viewer returned the currentness projection and rejected a correction
  attempt with HTTP 403.

The real loopback Viewer ran on port 19542. All 76 workstream records were
loaded, and the corrected finding was expanded to show its reason, predecessor,
evidence count, and detail. A full-page capture is retained as
`COR-001-independent-viewer-full.jpg` in the Codex task's visualization
artifacts, outside the repository and outside the release package. No token was
placed in the browser.

Fresh validation under Node.js 22.23.2:

| Step | Result |
| --- | --- |
| Focused COR-001 domain, CLI, and Viewer suites | 3 files, 26 tests, exit 0 |
| `npm run build` | exit 0 |
| `npm test` | 70 files, 826 tests, exit 0 |

A fresh external Codex harness read was prepared with an isolated config and no
answer-bearing prompt. Automatic approval review rejected the run because it
would transmit the disposable workspace contents to the signed-in model
service without separate explicit approval for that destination. The run was
not routed around that decision, and OpenCode was not started for the same
reason. Therefore this rerun independently confirms the local product,
authorization, catch-up, and real Viewer paths, but it does not add a new live
model/harness trace. The overall verdict remains **CONDITIONAL GO**; Gate B and
Gate C remain unmeasured.
