# UIX-001 fixture parity

Fixture evidence from the frozen ATT-001 lab workspace (`fixtures/attention/att-001`, scenario v2, `seedDatabase(..., true, "none")`). Not human comprehension. This does not rescore ATT-001. The five cold tasks remain NOT OBSERVED.

Dashboard column is the tall frame (`renderDashboard` at 120 columns and 80 rows). Viewer column is the orientation render of the same `get_workspace_context` object. Viewport column is `document.body.innerText` from the captured pages (not a full-page screenshot).

| Fact | Dashboard (tall frame) | Viewer | Viewport text |
| --- | --- | --- | --- |
| Goal id `goal_att001_attention` and title "Make team attention cues trustworthy without changing recorded work." | yes | yes | yes |
| Workspace id `ws_att001_lab` | yes | yes (workspace option value; visible label is the workspace name) | no (the control shows the name, not the id) |
| Task coverage 20 of 21 / 20/21, truncated, and cues beyond the returned pages may exist | yes | yes | yes |
| Ben My work empty list: more matching records may exist; not done and not caught up | yes | yes | yes |
| Ana Team work: `dec_att001_review_superseded` with `find_att001_superseded`, and `dec_att001_review_withdrawn` with `find_att001_withdrawn`, both `accepted`, not `retired` | yes | yes (Needs Attention, not Needs You) | yes |
| `dec_att001_competing_a` and `dec_att001_competing_b` both accepted; `operative` absent | yes | yes (alignment accepted list) | yes |
| `art_att001_runbook_ref` with `stored reference, not fetched`, not fetched | yes | yes | yes |
| Participant line includes `registered`; not `online` or `working` | yes | yes | yes |
| `find_att001_unrelated_sentinel` and `UNRELATED_FINDING_SENTINEL` absent | yes | yes | yes |

The dashboard lists returned artifact references in the tall frame. Before that display fix, no selectable row showed `art_att001_runbook_ref` with the stored-reference label, while the Viewer sources panel did. No service, schema, or route change.
