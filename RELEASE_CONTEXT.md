# Campfire 1.21.0 release context

This public source snapshot was exported on 2026-10-17 from private canonical source commit `28d7ca94237aa7bb068a7500206099da438d1bf3` (dated 2026-10-17T00:34:49-04:00). The identifier is retained for provenance; the private development history and private workspace data are intentionally not mirrored.

## Goal

Ship a harness-independent shared workspace where people and authorized agents can continue work from structured team state without sharing private transcripts.

## Decisions

- The workspace remains the collaboration and authorization boundary.
- Humans and agents remain distinct identities with inspectable provenance.
- Public Git history represents shipped snapshots, while intermediate development stays private.
- Campfire remains Apache-2.0, is not published to npm, and is distributed through checksummed release archives.

## Findings reflected in this release

- Structured goals, tasks, findings, decisions, artifacts, and contributions are sufficient for the demonstrated cross-harness continuation flow.
- Authorization must occur before state reaches a harness.
- A read-only journal makes current state and provenance inspectable without exposing an actor token to the browser.
- Agents orient more reliably when readiness, compact context, attention, alignment, and the next honest action are explicit at the interface boundary.
- A caller-held contribution cursor supports truthful return without storing read state or treating the cursor as a summary.
- Contribution and Workspace lifecycle writes preserve actor and active agent-session provenance across local and Workers services.
- Completed Workspaces remain readable with their structured state and contribution history intact.
- Anonymous product telemetry measures installation, activation, and return with an enforced field allow-list, a locally generated installation id, and no identity, content, or credentials; a fetch of the installer is recorded by the Worker and cannot be suppressed from the client.
- Orientation and catch-up stay bounded. Catch-up follows a durable per-workspace append position and a frozen stream tip, so a later contribution that shares a timestamp remains reachable.
- A finding can be corrected or withdrawn in place, and a decision can name one predecessor. The old text stays on the old row. Orientation keeps the current record and marks a decision that still cites a non-current finding.
- Orientation attention is honest about its own coverage: the projection states the returned task and decision page counts and whether the attention lists are complete under their selection rules, and an accepted decision whose cited finding is no longer current carries a team review cue with the cited ids. The cue does not revoke acceptance and does not choose an operative decision. Human comprehension of the updated attention semantics is unverified: the two-person trace is not observed.
- The read-only terminal console (`campfire dashboard`) and the refreshed local Viewer present the same authorized workspace read as two clients: goal, recorded participants, attention beside current work, decisions, source detail, and recent changes, with bounded coverage kept visible in both. Both keep private agent sessions private and never infer live presence from registration or recent activity. The five pre-registered cold-task comprehension observations are not recorded; this release is a founder override for real-user testing, not a comprehension result.
- The read-only Viewer separates accepted decisions needing review, lists open tasks, labels cited references, and shows completeness for bounded sections even when no rows are displayed. Human comprehension on this updated surface is unverified. Artifact previews and shared highlights remain deferred. Gate B and Gate C remain unmeasured. Production deployment is separate.
- One opt-in, static incident-investigation playbook is available through read-only CLI and MCP surfaces. It changes no workspace schema, default tool list, Viewer permission, or write path. A frozen synthetic pilot met its GO rubric through better recording in three matched pairs; continuation quality stayed at the baseline ceiling. This is not Gate B/C or ordinary team-use evidence.
- One generated workspace page is rendered at read time from the authorized orientation read. It is sandboxed, stored nowhere, and holds no Campfire credential. The release is a founder override. The human comprehension trace, the reference-open observation, and the presentation-defect finding remain open. This is not Gate B or Gate C.
- The loopback Viewer validates request `Host` before any route serves actor-bound data, including when the operator supplies `--allow-remote` while still bound to loopback.
- The Worker stops reading a request body once it crosses 1 MiB. Unexpected adapter failures return fixed client responses and log stable diagnostics without arbitrary exception text or workspace identifiers.
- Webhook due-delivery selection is bounded in SQLite and D1, and immediate sweeps follow only successful methods capable of enqueuing a delivery. Scheduled retries remain. A local SQLite benchmark reduced rows read for a 10,000-row backlog to 20; it does not measure production performance.
- Experimental Recall searches one authorized workspace and returns bounded source records with currentness, provenance, and a query-matched decision set. It does not select a workspace-wide operative decision. A named authorized recipient can receive a private local handoff packet with bounded context; the packet is not a credential or an instruction to act.
- The three frozen synthetic Recall pilots were NO-GO. A post-verdict packet projection repair has deterministic checks and one unscored recipient recheck. This release is a founder override for real-user testing, not a GO result or a demonstration of improved next actions. Gate E, B, and C remain unmeasured.
- The read-only Viewer adds a Shared Work Home: My work and Team work perspectives over one authorized orientation read, with a shared decision boundary, per-slice completeness, and inert artifact references. The perspectives are navigation over already-authorized shared records, not privacy modes; the page does not infer agent presence, fetch references, or assert unrecorded relations.
- The MCP session guidance and the `get_workspace_context` description now state that `needsAttention` is attention ordering, not an access boundary, and that a writing participant may take up a blocked or open task assigned to another participant with `update_task`, recorded under their own provenance. The change is guidance: authorization, attention reason labels, and the attention projection are unchanged.
- Finding-evidence relations are enumerated in the `cite_finding_evidence` and `correct_finding` tool schemas as `supports` or `contradicts`, validated against one shared vocabulary. Citations and corrections remain additive records that never edit the old assertion.
- The WCO-001 ordinary two-human continuation case was not observed; the witnessed gap comes from a labeled single-operator rehearsal, and the sprint remains CONDITIONAL GO — engineering candidate. This release is a founder override for real-user testing, not a human continuation result, and it moves no gate.
- The two controlled human comprehension traces, the shipped-v1.16 Viewer comprehension trace, the reference-open observation, and an ordinary two-human/two-agent continuation were not recorded before this release. The release is a founder override for real-user testing, not a GO result. Gate B, Gate C, and Gate E remain unmeasured.
- Artifact references now render with a typed, deterministic reference class (safe absolute HTTPS, insecure HTTP, credential-bearing, local path, other/internal scheme, or unparsed; control characters force inert text), the destination host for openable references, and the recorded Finding evidence relation where one exists; relations are never inferred and historical or competing decisions are not promoted. The Viewer adds a clearly labeled deliberate open control for safe absolute HTTPS references only — `noopener noreferrer`, no referrer, destination host shown, navigation only on the user's own activation, no rendering-time fetches — while the terminal stays inspect-only. Whether a person can use this to reach, verify, or act on an external output in ordinary work is unmeasured: the artifact-handoff human observations are NOT OBSERVED, the sprint result stands as UNSCORED, and Gate B/C/E/F remain open. Campfire never fetches, hosts, or verifies targets, and workspace membership does not grant external access.

## Artifacts

- This source snapshot and its manifest.
- The versioned installer source for v1.21.0.
- Darwin and Linux release archives for ARM64 and x64, with SHA-256 files, are produced by the public release workflow after publication.

## Verification

At source preparation, the private 1.21.0 candidate passed type checking,
build, local Darwin ARM64 packaging with a version-derived installer copy, and a
Worker deployment dry run. The full suite had 95 files / 1,166 tests with 1,164
passing, one opt-in terminal capture skipped by default, and one expected
install-channel assertion awaiting the four v1.21.0 release checksums;
that assertion was not loosened. The public export audit, archive verification,
channel pins, production deployment, and live installer check are separate
promotion steps and are recorded only when performed. This source snapshot does
not establish a human comprehension result, Gate E/B/C, or a production
performance claim.

Raw agent transcripts, local Campfire databases, credentials, internal runbooks, private evidence captures, and unshipped development history are not part of this release.
