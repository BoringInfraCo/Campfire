# Campfire 1.15.0 release context

This public source snapshot was exported on 2026-10-10 from private canonical source commit `c6a1d26810cd8f2abe3ba11b0865ad792941a41b` (dated 2026-10-10T00:39:29-04:00). The identifier is retained for provenance; the private development history and private workspace data are intentionally not mirrored.

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
- The read-only Viewer separates accepted decisions needing review, lists open tasks, labels cited references, and shows completeness for bounded sections even when no rows are displayed. Human comprehension on this updated surface is unverified. Artifact previews and shared highlights remain deferred. Gate B and Gate C remain unmeasured. Production deployment is separate.
- One opt-in, static incident-investigation playbook is available through read-only CLI and MCP surfaces. It changes no workspace schema, default tool list, Viewer permission, or write path. A frozen synthetic pilot met its GO rubric through better recording in three matched pairs; continuation quality stayed at the baseline ceiling. This is not Gate B/C or ordinary team-use evidence.
- One generated workspace page is rendered at read time from the authorized orientation read. It is sandboxed, stored nowhere, and holds no Campfire credential. The release is a founder override. The human comprehension trace, the reference-open observation, and the presentation-defect finding remain open. This is not Gate B or Gate C.
- The loopback Viewer validates request `Host` before any route serves actor-bound data, including when the operator supplies `--allow-remote` while still bound to loopback.
- The Worker stops reading a request body once it crosses 1 MiB. Unexpected adapter failures return fixed client responses and log stable diagnostics without arbitrary exception text or workspace identifiers.
- Webhook due-delivery selection is bounded in SQLite and D1, and immediate sweeps follow only successful methods capable of enqueuing a delivery. Scheduled retries remain. A local SQLite benchmark reduced rows read for a 10,000-row backlog to 20; it does not measure production performance.

## Artifacts

- This source snapshot and its manifest.
- The versioned installer source for v1.15.0.
- Darwin and Linux release archives for ARM64 and x64, with SHA-256 files, are produced by the public release workflow after publication.

## Verification

At source export, the private 1.15.0 candidate passed type checking,
packaging, a Worker deployment dry run, and a local Darwin ARM64 install from
its generated archive. The full suite had 980 passing tests and one expected
install-channel assertion awaiting the four v1.15.0 release checksums;
that assertion was not loosened. Archive verification, channel pins, production
deployment, and the live installer check are separate promotion steps. No
human comprehension trace, Gate B/C result, or production performance claim
follows from this release.

Raw agent transcripts, local Campfire databases, credentials, internal runbooks, private evidence captures, and unshipped development history are not part of this release.
