# UIX-001 candidate Viewer captures

Fixture evidence from the ATT-001 lab seed (`seedDatabase(..., true, "none")`). Not a human observation. The five cold tasks remain NOT OBSERVED. This capture does not rescore ATT-001.

Screenshots use the viewport only (`fullPage` is not set). Text files are `document.body.innerText`.

## Horizontal overflow

`document.documentElement.scrollWidth <= document.documentElement.clientWidth`

| Capture | scrollWidth | clientWidth | overflow |
| --- | --- | --- | --- |
| ana-lab-mine-1440x900 | 1440 | 1440 | no |
| ana-lab-team-1440x900 | 1440 | 1440 | no |
| ana-lab-mine-390x844 | 390 | 390 | no |
| ana-lab-team-390x844 | 390 | 390 | no |
| ben-lab-mine-1440x900 | 1440 | 1440 | no |
| ben-lab-mine-390x844 | 390 | 390 | no |

## Checks

- 1440x900 Ana My work text includes the goal title, an attention cue id, and a current-work id.
- 390x844 Ana My work text includes the goal id and the Needs You panel.
- Ben My work text, both viewports, includes "more matching records may exist" and truncated coverage wording.
- No text or PNG file contains `cft_`, `/Users/`, or the unrelated finding sentinel.
- Dispatch methods: get_activity, get_workspace, get_workspace_context, list_workspaces, whoami. No artifact fetch and no new route.
