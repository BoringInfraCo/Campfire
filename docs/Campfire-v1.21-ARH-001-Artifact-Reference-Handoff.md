# Campfire v1.21 — ARH-001: Artifact Reference Handoff

**Status:** Proposed contract; no baseline observation, product change, score, or release decision has been recorded.  
**Date:** October 16, 2026  
**Target:** A v1.21 product candidate only if an observed gap earns a bounded change; any publication requires a separate release decision.  
**Baseline source:** Published and deployed v1.20.1, private tag `v1.20.1` at `dc3c2a4c1f10f7815de78c4143fe564331406c73`; the later installer pin and release record do not change product behavior.  
**Roadmap:** `docs/ROADMAP.md` §21, “v1.21 candidate — make cited work usable in a handoff.”  
**Related evidence:** VIS-001 condition 4; SWH-001, WCO-001, ATT-001, and UIX-001 retain their own observation rules.

## 1. Sprint question

> Can an authorized teammate and a different agent find a cited external output from Campfire's recorded work, reach it with their own authority, and use it for a safe next step without a private transcript or a prepared recap?

Campfire already records Artifact references and renders them as “stored reference, not fetched.” The v1.20.1 console improves visibility, but visibility does not prove that a reference is usable. This sprint tests that gap on ordinary work before choosing link behavior. The expected product contribution is a **trustworthy path from a work claim to its external source**, not a Campfire file store.

This sprint belongs to the narrow edge of Phase 5: Campfire owns the workspace record; the external system owns the file, report, PR, or deployment. One case may inform a product repair. It cannot establish general team demand, retention, or that all referenced content is accessible.

## 2. Shipped baseline and invariant

| Area | v1.20.1 behavior | ARH-001 boundary |
| --- | --- | --- |
| Work state | Goal, Task, Finding, Decision, Artifact, and Contribution live in one authorized workspace. | No second store or transcript import. |
| Artifact | `id`, workspace, type, title, `uriOrPath`, optional metadata, and provenance; the reference does not contain or verify the target. | Do not turn Artifact into uploaded content, a preview, or a claim of external access. |
| Recorded evidence | A Finding can cite an Artifact with `supports` or `contradicts`; a Decision can cite a Finding. A nearby title or URI is not a recorded relationship. | Show only the links actually recorded. Do not infer that an Artifact supports a Decision or Task. |
| Human surfaces | `campfire dashboard` and the local Viewer show authorized references as inert text. The Viewer has five read methods, is actor-bound and read-only, and gives the browser no Campfire token. | Preserve the service authorization path and token-free browser. An external open, if earned, is a deliberate user action. |
| Agent surfaces | CLI JSON, MCP, and get-by-id reads expose existing authorized records. | No new agent credential, tool, packet authority, or protocol is implied. |

Decision safety applies throughout. Two accepted decisions may conflict; `needsReview` does not retire one; a superseded rationale remains historical. A reference cannot make a decision operative or current by itself. The existing workspace record and recorded transitions remain authoritative.

## 3. Scope and sequence

### 3.1 Freeze the v1.20.1 baseline

Before product edits, record the exact tag commit, package, CLI/dashboard, Viewer, service response, and five-method Viewer allowlist. Capture a token-free view of one authorized Artifact and its **actual** Finding evidence and Decision citation chain, if such a chain exists. Record page counts and truncation; absence from a bounded page is not absence from the workspace. Pin the source position used for each observation.

Prepare a small deterministic fixture with two authorized humans, their separately owned agents on different harnesses, one unauthorized actor, one safe HTTPS reference, one inert path/non-HTTPS reference, one stale or denied target, and competing or historical decision context. Freeze the key and source IDs before evaluating a candidate. Fixture behavior is engineering evidence only.

### 3.2 Observe a real reference-open attempt before choosing a repair

Use an existing ordinary-work task and an actual externally stored output that a participant has reason to inspect. A synthetic fixture, a fabricated URL, a scripted builder walkthrough, or an agent acting as the sole “human” does not qualify. One real human's attempt is enough to identify the access/navigation gap; the owner can count when doing ordinary work, with their role disclosed. For the full handoff claim in §6, use two distinct humans and two agent harnesses.

Before the recipient starts, the recorder identifies the relevant workspace records, source position, external system, expected access boundary, and a checkable safe next step. Verify that the target exists and document whether the recipient should have external access without showing the recipient the answer or opening it for them. The recipient gets only their own normal credentials and work tools. Do not direct them to the Artifact ID, external URL, or preferred action. Record their first Campfire read, path to the reference, attempted open, external access outcome, any manual help, interpretation, and dependent work. Preserve a denied attempt as a denied attempt; do not silently substitute a different link.

Classify the failure before coding:

| Observed cause | Sprint disposition |
| --- | --- |
| Reference is reachable and correctly used with the shipped surfaces | Record a bounded successful baseline. Do not invent a v1.21 feature or version bump to fill a slot. |
| Reference exists and the actor has external access, but Campfire makes it hard to locate, distinguish, or deliberately open | A small inspect/open repair may be scoped under §3.3. |
| External system denies the recipient, target is stale, or owner did not share it there | Record the external access failure. Campfire may clarify that boundary, but must not proxy around it or claim its own membership grants external access. |
| Required relation, authority, or source fact is not recorded | Stop and record NO-GO / REFRAME. Do not manufacture a structured relationship from proximity, URL shape, or a model summary. |
| No eligible ordinary-work reference attempt occurs | Mark the observation NOT OBSERVED. Fixture preparation may continue; no product repair is justified by a fabricated attempt. |

An actual attempt on a real accessible artifact may also be reviewed against VIS-001 condition 4. Record that decision in the VIS-001 result under its own rule; ARH-001 never declares the older condition met on its behalf.

### 3.3 Bound the product change with a dated amendment

If §3.2 identifies a Campfire gap, append a dated amendment **before implementing** it. Name the observed attempt and source position, exact affected surface, the smallest intended behavior, supported reference class, security boundary, deterministic checks, human falsifier, and what stays inert. Retain the baseline and failed attempt unchanged.

The default candidate is clearer inspection of the stored reference and its recorded evidence trail in the existing dashboard and Viewer. A deliberate external-open control is eligible only for a reference class the observation supports. For a first browser control, prefer an explicitly labeled absolute HTTPS destination, show the destination host, require a user gesture, and avoid opener/referrer propagation. Other schemes and local paths remain inert. No server-side fetch, proxy, preview, automatic navigation, speculative prefetch, shell command, local-file open, or network access merely from rendering is in scope. Hostile markup and control characters stay inert. A reference containing credentials or an unsafe scheme must not become an open control.

No Viewer read-method change is presumed. If the required record is unavailable through the existing authorized reads, the amendment must name the proposed method and separately review service authorization, the Viewer proxy allowlist, page bounds, and non-participant behavior before adding it. Do not widen `get_workspace` or add an unbounded fetch merely to make a button work. The dashboard and Viewer may have different controls, but must agree on the stored facts and access caveat. CLI JSON and MCP remain compatible.

A provider-specific connector, file upload, content ingestion, generated preview, artifact synchronization, new sharing policy, automatic task creation, notification, agent execution, and production-event integration are outside ARH-001. If those prove necessary, record the need and scope another sprint.

## 4. Authorization and evidence handling

- Campfire authorizes **reading the Artifact record** before either client displays it. The external system independently authorizes **opening the target**. Workspace membership must never be described as an external access grant.
- A user deliberately following an external reference leaves Campfire's trust boundary. The UI must state that the target is external and unverified by Campfire. A failed external open is not converted into a successful Campfire read.
- The Viewer remains actor-bound, read-only, and token-free. No browser-held bearer token, server-side URL fetch, redirect endpoint, or external target content is added to the workspace. The local Host/loopback boundary remains in force.
- Test wrong-workspace IDs, non-participants, and unauthorized actors before exposing a new action. They must not learn the title, URI/path, host, relation, counts, or access result through a response, error, or UI state.
- Retain source IDs, timestamps, access outcomes, verbatim participant interpretation, and the minimum sanitized external work-product reference needed to audit a claim. Do not retain raw prompts, transcripts, external contents, tokens, signed URLs, credentials, sensitive query strings, or customer data in the sprint evidence or public export. If the access result cannot be evidenced safely, mark it unscored.
- A participant can decline capture. The recorder logs the missing evidence; consent is not inferred from Campfire workspace membership.

## 5. Deterministic acceptance matrix

Freeze case inputs and expected behavior before the implementation is judged. If §3.2 finds no justified product change, report baseline checks only and do not write tests that mirror unchanged labels. For any amendment-authorized change, all applicable checks below are required.

| Check | Required result |
| --- | --- |
| **D1 — workspace authorization** | Authorized actors see the same workspace source facts; a non-participant or wrong-workspace ID reveals no Artifact or relation detail, including destination host and counts. Authorization precedes projection. |
| **D2 — recorded chain** | Artifact ID/type/title/reference/provenance, Finding evidence relation, Decision citation and lifecycle match existing records. Missing links remain missing; historical and competing decisions are not promoted. |
| **D3 — deliberate open** | Rendering, refresh, hover, and source inspection make no external request. Only an eligible deliberate action may navigate; unsupported schemes, local paths, credential-bearing references, and hostile markup remain inert. No server fetch or token propagation. |
| **D4 — external authority** | An external denial, stale link, redirect, or unavailable target is not reported as opened, verified, or accessible by Campfire. Campfire membership does not bypass the target system. |
| **D5 — surface parity and accessibility** | Dashboard, Viewer, CLI JSON, and MCP agree on stored facts; the human surfaces state the access caveat while JSON/MCP keep their existing contracts. An action is keyboard accessible, clearly labeled without relying on color, and exposes its destination class before navigation. |
| **D6 — compatibility and bounds** | Existing Viewer methods remain five unless an amendment explicitly approves a reviewed read. Existing page budgets, status JSON, Recall/packet schemas, artifact writes, SQLite/D1 paths, installer, and public asset sync still work. No new polling, schema migration, or unbounded read is introduced by default. |

Run focused tests, typecheck, the full relevant suite, build, packaging, and deployment dry-run for a release-shaped candidate. Verify the public Viewer assets match their source and inspect a real terminal and browser at narrow and wide sizes if those surfaces changed. Tests prove only the exercised behavior; they cannot prove the external system granted access or that a teammate understood the handoff.

## 6. Ordinary-work observation rubric

The recipient case uses Human A + Agent A and Human B + Agent B, with two distinct people and two different harnesses. They use one authorized Campfire workspace and their own external-system permissions. An eligible full handoff has at least one recorded Finding-to-Artifact evidence relationship; a Decision citation is scored when relevant and recorded. At least one human did not build the candidate. The case may begin with A having already recorded the work; it does not require simultaneous agents. A supplied private transcript or prepared recap is an intervention, not a Campfire handoff success. Record if the founder is a participant and whether the work was prompted for evaluation.

Freeze the relevant task, artifact, evidence, decision records, source positions, expected access, and safe outcomes before B begins. Give B only normal work instructions. Retain B's first interpretation before any hints; score before debriefing or editing the UI. After repair, use a new dated attempt and preserve the first attempt and its score. A simulated pair or agent-only run is a rehearsal.

Each item is **PASS**, **FAIL**, or **NOT OBSERVED**. Missing or unsafe-to-retain evidence is NOT OBSERVED, never PASS. Report every item and the participant's own words.

| Item | PASS requires | Critical? |
| --- | --- | --- |
| **H1 — find the source** | B locates the relevant Artifact by source ID through their own authorized Campfire read, distinguishes any similar or historical references that are present, and identifies the recorded Finding evidence relationship. | Yes |
| **H2 — reach with own authority** | B attempts to open the actual target through their own external-system identity and reaches it when preflight says access should exist. A denial is reported truthfully, but is not an open-and-use pass. | **Yes** |
| **H3 — decision safety** | B states the relevant Decision/Finding lifecycle and citations accurately, flags a conflict or `needsReview` when present, and does not promote a superseded rationale or choose an unrecorded operative winner. If none is recorded, B does not invent one. | **Yes** |
| **H4 — dependent next step** | B takes a checkable action using the cited output, or records a specific safe block when access or decision state prevents action. Merely restating the output or copying its URL fails. | **Yes** |
| **H5 — durable handoff** | B leaves the outcome in existing Task/Finding/Decision/Artifact state with B/Agent B provenance and enough source linkage or explanation for A to inspect without a private recap. | Yes |
| **H6 — return read** | A or Agent A later reads B's contribution in a fresh process and takes a dependent action or correctly records why work remains blocked. Opening the workspace alone fails. | Yes |

Record time to first correct source and safe action, wrong/conflicting answers, access failures, manual help, and later voluntary return as diagnostics. These have no post-hoc threshold. A case whose reference was never expected to be available to B is an access-boundary observation, not an eligible full handoff; record H2 as **NOT OBSERVED** for the open-and-use claim and do not award GO. If access was expected but denied, H2 is **FAIL** even when B reports the denial accurately. A later voluntary return is logged separately under Gate B rules, never supplied by an instructed return.

A second reviewer independently checks H2–H5 against the frozen key and sanitized source state. Retain disagreements and resolve them against the pre-run key. One successful case supports only these participants, this workspace, this reference, and this target system. It does not establish a causal gain over v1.20.1 without a matched comparison.

## 7. Verdict and release boundary

- **GO — bounded artifact handoff:** A real post-change or unchanged-baseline case meets H1–H6, including a successful H2 on a genuinely accessible target; D1–D6 pass if code changed; no authorization or decision-safety defect remains; second review agrees or resolves against the frozen key. If the baseline already works, record GO for the observed case with **no v1.21 feature or release required**.
- **CONDITIONAL GO — engineering candidate:** A real baseline attempt identified a Campfire gap, an amendment-authorized repair passes D1–D6, and a post-repair two-human/two-harness case is unavailable for a recorded reason. Claim only the verified behavior of the repair. Do not claim a successful handoff or that external access is guaranteed.
- **UNSCORED:** No eligible ordinary-work attempt has occurred, or no candidate has been evaluated. Fixture tests and a builder walkthrough cannot turn this into a human result.
- **NO-GO / REFRAME:** Unauthorized reference exposure, unsafe automatic navigation/fetch, external credential leakage, false access claim, invented evidence relation, decision-status error, failure of H2–H4 in an eligible post-repair case, or a requirement for storage, proxying, a new sharing policy, or a broad connector blocks the bounded claim. Preserve the failure and scope a new attempt or separate decision; do not edit the frozen key to rescue a result.

An initial failed attempt is diagnostic evidence, not the final verdict on a later repaired candidate. A code change cannot retroactively turn that attempt into a pass. WCO-001, SWH-001, ATT-001, UIX-001, RCL-001/002/003, and VIS-001 keep their existing result records. ARH-001 does not by itself close Gate B, C, E, or F; an observation can be considered under another gate only through that gate's separately applicable protocol and record.

A package bump, private tag, public snapshot, GitHub Release, channel pins, and production deployment require a **separate release decision** after this result is recorded. If the founder authorizes publication with an open or failed human observation, record the exact waiver, unresolved facts, and bounded public claim. A release override cannot turn NOT OBSERVED or FAIL into PASS.

## 8. Deliverables and order

1. Freeze the v1.20.1 baseline and deterministic fixture/key in `docs/evidence/arh-001/` and `fixtures/artifact-handoff/arh-001/`, with a sanitized evidence plan. No seeded fixture is passed off as ordinary work.
2. Record one ordinary-work reference-open attempt and its failure classification, or record NOT OBSERVED with a reason. Keep the external access result and VIS-001 attribution explicit.
3. If a Campfire gap is observed, append the §3.3 scope/security amendment, implement only that bounded repair, and verify D1–D6. If no gap is observed, stop without a feature.
4. When two real participants are available, run a fresh handoff, score H1–H6, and preserve any earlier failed attempt. Record later voluntary return separately.
5. Write `docs/SPRINT_ARH_001_RESULT.md` with exact source commit, eligibility, baseline and candidate behavior, item-level scores or NOT OBSERVED reason, deviations, reviewer disagreement, verdict, and residual risk. Update roadmap/AGENTS only for facts actually established.
6. Make a separate founder release decision if a v1.21.0 publication is proposed.

