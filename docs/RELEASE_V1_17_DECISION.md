# v1.17 release decision — Shared Work Home

**Date:** October 14, 2026

**Status:** Public release preparation under founder override. Promotion steps are recorded here as they complete.
**Package target:** `1.17.0`

## Founder direction and scope

On October 14, 2026, the repository owner directed a public v1.17.0 release:

> "lets launch v1.17 to the public now! lets tag it and make sure our install commands have the updated version!"

This is the **separate, recorded founder override** that the October 14
direction in `docs/SPRINT_SWH_001_RESULT.md` §9 and contract §8 require for a
bounded publication with open observations. It is a release-scope override of
the SWH-001 evidence hold. It is **not** a GO verdict: the contract requires
two controlled human comprehension traces before GO or CONDITIONAL GO, and
those traces have not been run. The override does not turn any absent
observation into a pass.

The bounded release surface is the implemented one: the read-only **Shared
Work Home** in the local actor-bound Viewer — My work and Team work
perspectives over the same authorized `get_workspace_context` read, a shared
decision boundary, bounded completeness for every displayed slice, and inert
artifact references. It is not a hosted or shared-login team experience. No
new read method, write, page family, schema, CLI, MCP, worker, or telemetry
change is included; the five-method Viewer allowlist and the token-free
browser are unchanged.

## Evidence that remains adverse or absent

| Evidence | Release record |
| --- | --- |
| SWH-001 controlled human trace (H1–H7) | **Not run.** Both required participants and the item-level scoring are outstanding. |
| Shipped-v1.16 Viewer comprehension trace | **Not run.** Owed since VIS-001; the v1.16 baseline records why. |
| Reference-open observation (VIS-001 condition 4) | **Open.** No ordinary-work attempt has been observed. |
| Ordinary two-human/two-agent continuation | **Not observed.** |
| Gate B / Gate C / Gate E | **Unmeasured.** Publication does not satisfy any gate. |
| D1–D7 deterministic checks | **Pass** on the pinned candidate `d7e3b62`; full suite 1,064 tests at pin; one expected install-channel assertion awaits the v1.17 archives until the pins move. |

The contract's §8 GO and CONDITIONAL GO criteria are **not met**. The
override waives only the publication hold and the trace-before-publication
sequence for this bounded candidate. A critical human failure found later is
repaired and retraced; it is not retroactively treated as a pass.

## The exact public claim

Campfire v1.17 adds a read-only **Shared Work Home** to the local actor-bound
Viewer: My work and Team work perspectives over one authorized workspace, a
shared decision boundary for proposed, accepted, needs-review, and historical
records, per-slice completeness, and inert artifact references. It is
**experimental**: no human comprehension evidence has been recorded yet, and
the frozen H1–H7 rubric is unscored. It is not a hosted shared-login team
service. No Gate B, Gate C, or Gate E claim follows.

## What users should know

- The perspectives are presentation filters over already-authorized workspace
  records, not privacy modes. Sensitive words placed in shared records are
  visible to every authorized participant.
- Artifact references are stored references, not proof of existence or access;
  the page does not fetch, preview, or link them.
- The Viewer stays loopback by default and bound to one actor; a Viewer URL is
  not a share link.
- A task or decision is "mine" only when its recorded assignee says so; the
  page never infers agent presence or unrecorded relations.

## Promotion record

Promotion steps are recorded here when they occur.
