# Changelog

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
