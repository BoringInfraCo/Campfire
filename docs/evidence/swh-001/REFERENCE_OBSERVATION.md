# SWH-001 — VIS-001 condition 4 reference-open observation

Status page for the open VIS-001 condition 4 (evidence about which artifacts
people actually try to open), per contract §§6.1–6.3. This file records what an
observation must contain and its current status. Nothing here is an observation.

## What to record for one attempt

Record **one** real participant's attempt to open **one real, accessible**
artifact reference during ordinary work (preferably outside the Viewer):

| Field | Record |
| --- | --- |
| Date / time (UTC and local) | when the attempt happened |
| Participant | participant code / actor id; whether they are a builder |
| Where | ordinary work (editor, terminal, browser, chat) or the Viewer; note the tool |
| Artifact type | e.g. `log`, `trace`, `report`, `file`, `pull_request` |
| Stored reference | the `uriOrPath` as recorded in Campfire, after redaction |
| Why they sought it | the task or question that required the artifact |
| Reached with own authority? | yes / no / partial; what authorization was needed |
| Outcome | opened / failed / denied / abandoned, with the visible reason |
| Content needed | what they actually needed from the artifact (preview, lines, section) |
| What would have helped | only if they say so; do not prompt a preview wish |

An attempt is an **action to open**, not a request to Campfire to display the
reference. The Viewer listing a reference, a fixture containing one, or an agent
selecting an artifact is not an attempt.

## Redaction rules (contract §6.3)

- Retain: answers, source IDs, sanitized UI state, and the access outcome needed
  to audit the claim.
- Redact from public evidence: sensitive paths, external artifact contents,
  customer secrets, tokens (`cft_` strings), private session prompts/responses,
  terminal transcripts, and other participants' private material.
- Never fetch or store the external artifact's contents to "prove" the attempt;
  record the metadata and outcome only.
- A refusal to record is respected and yields **no scored observation**; do not
  retain a partial record over the participant's objection.

## Current status

**OPEN — not yet attempted.** As of 2026-10-14 (UTC), no ordinary-work
reference-open attempt has been observed or recorded.

This is a status, not a dated absence: a dated absence would require an actual
participant's ordinary-work interval in which no attempt occurred. No such
interval has been observed. VIS-001 condition 4 therefore remains open, and no
artifact preview, link affordance, external fetch, or `VIEWER_READ_METHODS`
change is justified by this fixture or by the Viewer merely displaying a
reference.

The controlled scenario's known-accessible artifact (`art_swh001_runbook_ref` →
`docs/ARCHITECTURE.md`, see `SCENARIO_KEY.md`) exists for H5/N scoring only; the
controlled trace is not an ordinary-work reference-open observation and cannot
close condition 4.
