# Campfire — Sprint GWV-001 Result: Generated Workspace Views

**Date:** October 9, 2026

**Status:** Founder-directed continuation; the bounded engineering candidate is integrated with the v1.13 release source. The original evidence gate remains open. No publication or deployment has occurred.

**Contract:** `docs/Campfire-v1.14-GWV-001-Generated-Workspace-Views.md`

## 0. Founder override, October 9, 2026

The repository owner explicitly directed a founder override for GWV-001 and asked to continue building the roadmap. This authorizes only the bounded, read-only generated workspace view in the contract. It does not claim that the entry conditions were met.

| Condition | Record at override |
| --- | --- |
| Human comprehension on the shipped v1.12 Viewer | **Unmet.** The earlier VIS-001 human trace predates the shipped slice. |
| Reference-open observation | **Unmet.** No qualifying attempt is recorded. A dated absence cannot count before October 14, 2026. |
| Presentation defect in otherwise explainable state | **Unmet.** No post-release human trace has established this distinction. |
| Gate B voluntary repeat use | **Unmeasured.** For this one bounded candidate, the requested override uses the roadmap §21 reading: Gate B may remain unmeasured and the view does not claim it. This is an explicit implementation exception to §15's sentence that would otherwise keep the view behind the gate while Gate B is unmeasured. It does not revise either roadmap sentence. |
| Gate C ordinary multi-participant value | **Unmeasured.** |

The owner waives the contract's §2 prohibition on sprint scope, §7 non-goal of implementation while the gate is open, §8 step 1's instruction to leave product code untouched, and §9's unmet-gate NO-GO criterion **for implementation of this bounded candidate only**. The override does not turn an unmet condition into evidence and does not authorize publication or production deployment. The October 7 VIS-001 overrides applied to v1.12 only; the v1.13 synthetic recording gain is not evidence for this gate.

On October 9, the founder clarified that Campfire already has users, that they have personally tested it, and that it is working as planned. They directed the team to continue moving. This is a first-party product assessment and a decision to continue GWV-001 integration and release preparation despite the open evidence gate. No user count, trace protocol, reference-open attempt, or test of this generated page was supplied with that statement, so none is inferred here. The founder decision governs whether this bounded work proceeds; the rows above remain accurate descriptions of recorded evidence.

## 1. Frozen scope under the override

The candidate is one static-behavior HTML page rendered at read time from one authorized `get_workspace_context` result for the loopback Viewer's bound actor and one workspace. It shows the current position, service-computed review markers, and explicit completeness counts. It is discoverable from the existing journal. It makes no further request, holds no credential, stores nothing, and creates no Contribution. Historical records remain in existing drill-down reads; the page may show their counts but must not claim to contain them.

The page uses escaped text and a restrictive browser policy. It cannot run script, fetch a reference, call `/api/call`, or inherit the journal origin's ambient authority. There is no new Viewer read method, MCP tool, write, schema change, webhook, telemetry event, playbook, preview, or highlight.

This scope is a founder-chosen product hypothesis, **not** a finding that a human needs this page. If the missing human trace later shows a state defect or a different presentation need, reframe before release.

## 2. Implementation and checks

The loopback Viewer serves `GET /generated/workspaces/<workspaceId>` by making one existing `get_workspace_context` call through its bound actor. An unauthorized or absent workspace returns a generic 404 before markup is rendered. The generated page escapes contributed text and has no script, active artifact link, external resource, credential, or subsequent Campfire call. A decision the service marks `needsReview` shows that marker and the cited finding ids. Current-work counts are labeled as counts of returned orientation items. When the task or decision section is truncated, the page says those counts are not workspace totals. A restrictive Content Security Policy includes `sandbox` without `allow-same-origin`, `script-src 'none'`, and `connect-src 'none'`. Responses are not cached. The existing journal links to the page for its selected workspace; its five-method read allowlist is unchanged. No store or domain file was changed.

Two defects in the first candidate were fixed before this record:

- The current-work line could be read as workspace totals. The in-progress and blocked numbers come from the bounded task page. The line now says they are among returned orientation items, and a truncated task or decision section says its count is not a workspace total.
- `needsReview` was only the words "needs review". The page now includes `needsReviewFindingIds` from the same decision object.

Checks run against the original local `main` checkout with Node 22:

- `npm run typecheck` — passed.
- Focused generated-view integration checks — 4 passed, including nonparticipant and absent workspace denial, hostile markup as text, orientation completeness, a withdrawn finding kept out of current items, a review marker with its cited finding id, non-persistence, the exact `sandbox` directive, and the unchanged write refusal.
- `npm test` — 912 passed across 76 files.
- `npm run build` — passed on the earlier candidate and synced the Viewer static files to `public/`. This fix does not change those static files.
- Browser load of a seeded workspace whose finding body contained a script and an image aimed at `/api/call`. Headless Chrome 153 requested the generated document as the main frame. The response CSP was the policy above. The dumped document had zero `<script` tags and showed the script as escaped text. The net log contained no `/api/call` URL. Chrome also preconnected to the server origin; that was a connection warmup, not a journal navigation and not a Campfire method call. Chrome's own component-update requests were unrelated. `--dump-dom` did not exit on its own and the process was stopped after the log was recorded.

The three GWV-001 commits were then replayed without conflict onto the v1.13.0 release source (`origin/main` at `8e5d3dd`) in a detached integration checkout. On that source, `npm run typecheck` passed and `npm test -- --silent` passed with 952 tests across 80 files. These are engineering checks, not a human comprehension trace or proof of voluntary return. The original local `main` checkout has unrelated uncommitted telemetry and evidence work; its preservation and integration are tracked separately from this result.

## 3. Verdict and remaining evidence

**Founder continuation decision: PROCEED with the bounded GWV-001 engineering candidate and release preparation.** The original contract's evidence-only §9 rubric would still read **NO-GO / REFRAME** because §2 is unmet; it is retained as an evidence assessment, not a stop on founder-authorized work. The human comprehension trace on the shipped v1.12 Viewer, the reference-open observation or a dated absence on or after October 14, the presentation-versus-state finding, and a human trace on the generated document remain outstanding. Gate B and Gate C remain unmeasured. Publication and production deployment are separate promotion steps and have not been performed.
