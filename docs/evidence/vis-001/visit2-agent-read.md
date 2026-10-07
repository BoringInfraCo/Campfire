# VIS-001 entry-gate evidence — Return read (AGENT-SIDE, not a human return visit)

**Date:** 2026-10-04 (UTC)
**Reader:** coding agent, using ONLY the Viewer's read allowlist
  (`get_workspace_context` with `since`, `get_activity`, `list_workspaces`) via
  http://127.0.0.1:19415/api/call as hum_grace. Browser never held a token.
**Status:** This is NOT the required "real human return visit". It is an agent
  corroboration of the presentation defect recorded in `visit1-human-answers.md`,
  and of the read surface's ambiguity on return. It does not satisfy the human
  return-visit half of the product trace.

## Changes since the participant's visit (authoritative, append order)

| pos | created | change | object |
| --- | --- | --- | --- |
| 97 | 2026-10-04T17:48:19Z | artifact create | `art_6e027ba110f04336` "Reload window log (02:40 retry)" -> `reload-window-retry.log` |
| 98 | 2026-10-04T17:48:20Z | finding create | `find_231ae328687c4f12` "The 02:40 retry also dropped rows; the reload window repeats nightly" |
| 99 | 2026-10-04T17:48:20Z | task update | `task_235f9612e64c4b20` "Reload the March export" -> `in_progress` |

`context.since.truncated: false` (delta complete); stream tip is append position 99.

## Answers derived from the Viewer's served state

1. **What changed:** the three rows above. The `since` delta is complete and names each object.
2. **Current decision:** `dec_f9bd16ad4d8f44e6` "Skip the cache flush and rerun the export after the
   reload window". Unchanged by the new finding. The Viewer still lists the `needsReview` precaution
   `dec_80dad7d77e47449d` first; nothing marks the operative decision.
3. **Current finding:** now two current findings compete (`find_bc006e9c442a4f1a` and
   `find_231ae328687c4f12`) with 14 background notes. The new finding is `current` and is NOT recorded
   as superseding or contradicting the earlier one, so "what the team currently believes" is ambiguous
   in the served data, not only in the UI.
4. **Next useful action:** `currentWork.inProgressTasks` = "Reload the March export" (now visible).
   `suggestedNextAction` still points at the proposed chalkboard decision, and the Viewer drops that
   hint's `kind`/`id` when rendering it.
5. **Needs review:** `dec_80dad7d77e47449d` remains flagged. Nothing flags that the "skip the flush"
   decision may now be questionable given the new nightly-reload finding.
6. **Artifact for the new claim:** `art_6e027ba110f04336` (`reload-window-retry.log`). Opening it in the
   Viewer shows only the URI as plain text; no link, no preview, `get_artifact` not allowlisted. The
   file is not readable from the workspace.
7. **Confusion / old-state-as-current:** accepted decisions ordered by recency put the `needsReview`
   precaution above the operative decision; truncation is invisible (decisions 14->10, findings 16->10,
   artifacts 15->10); two competing "current" findings with no supersession link.

## Distinguishing comprehension vs data

Items 2, 4, 6, 7 are presentation/completeness defects on correct service data. Item 3 (two competing
current findings, no supersession) is arguably a genuine data-modelling ambiguity introduced by adding
a new finding without a correction — not a Viewer defect. This distinction is recorded honestly.
