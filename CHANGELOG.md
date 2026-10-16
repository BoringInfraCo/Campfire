# Changelog

## 1.20.1 — 2026-10-16

- Add a read-only terminal console: `campfire dashboard [workspace]` renders one authorized `get_workspace_context` read as an interactive TTY screen — goal, recorded participants, attention beside current work, decisions, source detail, and recent changes — with `p` perspectives, `tab`/`j`/`k`/`enter` inspection, a rate-limited `r` refresh, and `q` quit that restores terminal state on every exit path. A non-TTY call returns the `campfire status --output human|json` instruction and writes no cursor controls; `status` JSON is unchanged, and record text is stripped of control sequences before it is written.
- Share one presentation-label table (`src/presentation/work-console.ts`) between the dashboard and the Viewer instead of parallel caption rules; a drift test fails if the Viewer sentences and the shared labels diverge.
- Refresh the read-only Viewer: attention beside current work on wide screens, stacked panels on narrow screens, recorded participant counts, the goal id, and a local density preference. The five Viewer read methods are unchanged.
- First published 1.20 release, superseding an unpublished v1.20.0 candidate that was held before promotion because its terminal evidence-capture test required a machine-local Playwright install; the required suite now runs without Playwright and keeps the PTY behavior checks, and screenshot capture is an opt-in evidence step.
- Published under a founder release-scope override. UIX-001 remains CONDITIONAL GO — engineering candidate: the five pre-registered cold tasks are NOT OBSERVED, and a fixture capture is not a comprehension result. Both clients project existing authorized workspace state, keep private agent sessions private, and never infer live agent presence from registration or recent activity. This release does not claim comprehension, human continuation, or team-value results, and it moves no gate (Gate B/C/E/F, ATT-001, WCO-001, SWH-001, and VIS-001 condition 4 remain open). No schema, migration, MCP tool, write path, or Viewer read-method change is included.

## 1.19.0 — 2026-10-15

- Qualify attention coverage in `get_workspace_context`: the response states the returned task and decision page counts and whether the attention lists are complete under their selection rules. A truncated source page can no longer read as an unqualified all-clear, and an empty list means "no cue matched the returned records", never that the team is done.
- Add a team review cue (`accepted_decision_needs_review`) for a returned accepted decision whose existing read-time `needsReview` flag is set, carrying the cited non-current finding ids. The cue stays out of `needsYou`, does not revive a superseded decision, does not revoke acceptance, and is not elevated to `suggestedNextAction`.
- The read-only Viewer renders coverage-qualified empty and nonempty attention lists, plain-language reason labels (raw codes retained in `data-reason`), cited non-current finding ids, and the recorded assignee, and states that recorded assignment is not a permission.
- Published under a founder release-scope override. ATT-001 remains CONDITIONAL GO — engineering candidate: the eligible two-person comprehension trace is NOT OBSERVED, and a labeled subagent rehearsal is not human evidence. This release does not claim comprehension, Gate B, Gate C, Gate E, Gate F, or resolution of the WCO-001/SWH-001 observations. No schema, migration, budget, cursor, read-method, notification, or coordination change is included.

## 1.18.0 — 2026-10-15

- State in the MCP session guidance that `needsAttention` is attention ordering, not an access boundary: a blocked or open task assigned to another participant is still shared work, and a writing participant may take it up with `update_task`, recorded under their own provenance.
- Make the evidence-relation vocabulary explicit: `cite_finding_evidence` and `correct_finding` enumerate `supports` or `contradicts` in their input schemas, and the citation description names the closed set. The service validator and the shared constant now agree.
- Clarify the `get_workspace_context` description (`needsYou` versus `needsAttention`) and correct an internal doc comment.
- Published under a founder release-scope override. WCO-001 remains CONDITIONAL GO — engineering candidate: the eligible two-human/two-harness case is NOT OBSERVED, and the witnessed gap came from a labeled single-operator rehearsal. This release does not claim human continuation, Gate B, Gate C, Gate E, or VIS-001 condition 4. No orientation selection rule, CLI, Viewer, HTTP, Worker, or schema change is included.

## 1.17.0 — 2026-10-14

- Added a read-only Shared Work Home to the local actor-bound Viewer: My work and Team work perspectives over the same authorized orientation read, a shared decision boundary for proposed, accepted, needs-review, and historical records, per-slice completeness, and inert artifact references.
- My work leads with the service attention projection, then tasks assigned to the caller or their participating owned agents. Team work leads with team attention, then participants and their agents with tasks grouped by recorded assignee, including unassigned and ownership-unknown cases. Neither perspective infers agent presence or relations that were not recorded.
- Published under a founder release-scope override for real-user testing. The two controlled human comprehension traces, the shipped-v1.16 Viewer trace, the reference-open observation, and an ordinary two-human/two-agent continuation remain unrecorded; Gate B, Gate C, and Gate E remain unmeasured. This is not a GO result.

## 1.16.0 — 2026-10-13

- Added experimental, authorized one-workspace Recall through CLI, MCP, and HTTP. Results are bounded, identify source records and currentness, and report truncation. A query-matched decision set shows recorded links and unresolved conflicts without inferring a workspace-wide operative decision.
- Added an explicit local handoff-packet writer for one named authorized recipient. The private JSON packet carries bounded context and provenance, writes no Campfire contribution, and is not a credential or an automatic instruction to act.
- Corrected the post-pilot packet projection so superseded decisions remain historical in the decision set, their rationale is not presented there as live, and linked-next-step guidance reaches the offline recipient.
- Published under a founder release-scope override for real-user testing. RCL-001, RCL-002, and RCL-003 remain **NO-GO** on their frozen synthetic rubrics; the correction has deterministic checks and one unscored recipient recheck, not a new scored pass. Gate E, B, and C remain unmeasured. Do not treat a recalled or packet decision as authority to execute without checking its lifecycle and recorded transitions.

## 1.15.0 — 2026-10-10

- Validate `Host` on the loopback Viewer before serving actor-bound pages and API responses, including when `--allow-remote` is supplied with a loopback bind.
- Bound Worker request bodies to 1 MiB while streaming, and return fixed responses for unexpected HTTP, Viewer, and Worker errors without logging arbitrary exception text.
- Limit webhook due-delivery reads to one configured batch in SQLite and D1. Immediate delivery sweeps now follow only writes that can enqueue an event; scheduled retries remain.
- Update the MCP SDK and Wrangler dependency graph to versions with no advisories reported by the release-candidate npm audits.
- The delivery benchmark measured local SQLite rows read, not production latency or D1 cost. This release does not establish Gate B or Gate C.

## 1.14.0 — 2026-10-09

- Added one derived workspace page to the loopback Viewer. It renders the authorized orientation read for one actor and one workspace, escapes contributed text, and applies a sandbox content security policy with no path back to Campfire.
- The page is produced for that read. It is stored nowhere, creates no Contribution, and leaves the workspace complete when it is absent.
- Published under a founder override. The human comprehension trace, the reference-open observation, and the presentation-defect finding remain open. This is not Gate B or Gate C.

## 1.13.0 — 2026-10-08

- Added one opt-in, versioned incident-investigation playbook. `CAMPFIRE_PLAYBOOK=1 campfire playbook` and MCP `get_playbook` expose the same read-only definition; default surfaces remain unchanged.
- Ran a frozen synthetic six-arm pilot with two independent blind scorers. After source-audit resolution, all three treatment runs passed and all three matched pairs improved recording quality without lower continuation quality.
- The pilot is GO under its preregistered rubric. It does not establish Gate B/C, real-user value, or a continuation gain; the v1.12 Viewer human trace remains open.

## 1.12.0 — 2026-10-07

- Made the read-only Viewer distinguish accepted decisions that need review, show open tasks and cited references, and report completeness even when no rows are displayed.
- Aligned accepted-decision ordering across the service's current-work and alignment projections.
- Published with a CONDITIONAL verdict under the recorded founder override. Human comprehension on the updated Viewer and artifact-open behavior remain unverified; previews and shared highlights are deferred.

## 1.2.0 — 2026-09-25

- Added agent readiness preflight and compact, authorization-aware workspace orientation.
- Added recorded alignment guidance, caller-supplied return cursors, natural contribution boundaries, and truthful Workspace closure guidance.
- Required active registered agent sessions for Workspace lifecycle writes and preserved session provenance across local and Workers paths.
- Hardened Workers write completion, CLI JSON behavior, release packaging, and the audited private-to-public snapshot boundary.

## 1.1.0 — 2026-09-15

- Added the read-only Campfire Viewer journal with the Campfire palette and logomark.
- Preserved the existing workspace, identity, authorization, provenance, CLI, MCP, HTTP, and Workers/D1 behavior.
- Published checksummed archives for Darwin and Linux on ARM64 and x64.
- Established this release as the first clean snapshot in the public source mirror.

Earlier development history and intermediate commits remain in Campfire's private canonical repository.
