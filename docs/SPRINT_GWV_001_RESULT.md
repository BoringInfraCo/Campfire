# Campfire — Sprint GWV-001 Result: Generated Workspace Views

**Date:** October 9, 2026

**Status:** Published and deployed as v1.14.0 on October 9, 2026, under the founder override. The original evidence gate remains open. This is not a GO, Gate B, or Gate C result. The publication record is in section 5.

## 4. Release candidate checks

On October 9, 2026 the private candidate was set to package version 1.14.0. `npm run typecheck` passed. `npm run pack:tarball` built the Darwin ARM64 archive and tracked `public/campfire/v1.14.0/install.sh`. `npm run deploy:dry-run` passed. `npm test` passed 951 tests. The one failure is the expected install-channel assertion: the formula and flake still name the published v1.13.0 archives, because the v1.14.0 checksums did not exist yet. That assertion was not loosened. The three other install-channel checks passed. The install-channel commit in section 5 resolved that failure. The post-pin suite passed 952 tests across 80 files.

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

The owner waives the contract's §2 prohibition on sprint scope, §7 non-goal of implementation while the gate is open, §8 step 1's instruction to leave product code untouched, and §9's unmet-gate NO-GO criterion **for implementation of this bounded candidate only**. The override does not turn an unmet condition into evidence. The October 7 VIS-001 overrides applied to v1.12 only; the v1.13 synthetic recording gain is not evidence for this gate.

Later the same day, the owner directed that this bounded candidate be committed, pushed, and deployed to production. That instruction is the release authorization. It does not change the evidence rows above, and it does not make the release a GO, Gate B, or Gate C result. The contract's own rubric remains NO-GO / REFRAME. The shipped page is the bounded engineering candidate.

On October 9, the founder clarified that Campfire already has users, that they have personally tested it, and that it is working as planned. They directed the team to continue moving. This is a first-party product assessment and a decision to continue GWV-001 integration and release preparation despite the open evidence gate. No user count, trace protocol, reference-open attempt, or test of this generated page was supplied with that statement, so none is inferred here. The founder decision governs whether this bounded work proceeds; the rows above remain accurate descriptions of recorded evidence.

## 1. Frozen scope under the override

The candidate is one static-behavior HTML page rendered at read time from one authorized `get_workspace_context` result for the loopback Viewer's bound actor and one workspace. It shows the current position, service-computed review markers, and explicit completeness counts. It is discoverable from the existing journal. It makes no further request, holds no credential, stores nothing, and creates no Contribution. Historical records remain in existing drill-down reads; the page may show their counts but must not claim to contain them.

The page uses escaped text and a restrictive browser policy. It cannot run script, fetch a reference, call `/api/call`, or inherit the journal origin's ambient authority. There is no new Viewer read method, MCP tool, write, schema change, webhook, telemetry event, playbook, preview, or highlight.

This scope is a founder-chosen product hypothesis, **not** a finding that a human needs this page. If the missing human trace later shows a state defect or a different presentation need, reframe before any further surface.

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

The three GWV-001 commits were then replayed without conflict onto the v1.13.0 release source (`origin/main` at `8e5d3dd`). On that source, `npm run typecheck` and `npm run build` passed, and `npm test -- --silent` passed with 952 tests across 80 files. The result is now on a clean local `main`; unrelated uncommitted telemetry and evidence work was preserved in its original state in a separate checkout. These are engineering checks, not a human comprehension trace or proof of voluntary return.

## 3. Verdict and remaining evidence

**Founder continuation decision: PROCEED with the bounded GWV-001 engineering candidate.** The original contract's evidence-only §9 rubric still reads **NO-GO / REFRAME** because §2 is unmet; it is retained as an evidence assessment. The human comprehension trace on the shipped v1.12 Viewer, the reference-open observation or a dated absence on or after October 14, the presentation-versus-state finding, and a human trace on the generated document remain outstanding. Gate B and Gate C remain unmeasured. Publication and production deployment were performed under the separate owner authorization in section 0. They do not close this evidence assessment.

## 5. v1.14.0 publication and verification

- Private canonical source and annotated `v1.14.0` tag:
  `1274c0b9283de0f5648bbc99430c9d4dd480ab09`. The tag was not moved.
- Public source snapshot: `BoringInfraCo/Campfire` commit
  `49abdef9e89d8e6aa87215287f8d9479612b10ad`, also the immutable public
  `v1.14.0` tag. The public release is
  `https://github.com/BoringInfraCo/Campfire/releases/tag/v1.14.0`.
- The public release workflow `38013198597` passed all four native-platform
  jobs and attached four archives plus four `.sha256` files. Each downloaded
  archive independently passed `shasum -a 256 -c` against its published file:

  | Archive | SHA-256 |
  | --- | --- |
  | `campfire-darwin-arm64.tar.gz` | `1915b09ae47ea908791707d879540cae5ba39855c0dae19ae8a79ad6852d1c53` |
  | `campfire-darwin-x64.tar.gz` | `bd3d3fff9fbf2f9db22a6811862c02fb9609f73b7ad9018e42a101e797104278` |
  | `campfire-linux-arm64.tar.gz` | `e4b804863fa62e2e75f0428c10a620da16db8d771c59265f3a0a18500800647b` |
  | `campfire-linux-x64.tar.gz` | `fadf79adaac4c0b3a9de71cc097a8a54ba1e805521bdf95fd84b32c498f2e4ac` |

- Actual release digests were applied to private Homebrew and Nix pins in
  `908369bb5d3c0e544ce67ebaf92a5a5ac4a6c06c`. The post-tag public pin
  addendum is `12757c7f847aaf3a0d868efdb2f9809f2100b0b8`; the public tag
  was not moved. Its manifest names the private install-channel commit.
  The public Homebrew tap formula was promoted in
  `ff4122d8a131e9907491190732a5c83477f374b9`.
- The full private post-pin suite passed **952 tests across 80 files**.
  Private CI `38013620100` and public CI `38013650032` passed on the
  post-pin commits. The earlier public snapshot CI `38013191395` failed
  only on the expected v1.13 pin assertion before the v1.14 archives were
  pinned: 1 failed and 908 passed. No assertion was loosened.
- `npm run deploy` from the private release tree deployed Worker version
  `9bd1b548-cc1f-43e2-814d-e61751668f6d` to
  `boringinfra.company/campfire/*`. No migration was applied. A live **GET**
  of `/campfire/v1.14.0/install.sh` and `/campfire/install.sh` matched the
  tracked files byte for byte. The live v1.13.0 installer was unchanged.
  The live versioned installer completed a clean Darwin ARM64 install into
  a temporary prefix, verified archive SHA-256
  `1915b09ae47ea908791707d879540cae5ba39855c0dae19ae8a79ad6852d1c53`, and
  the installed package metadata and `campfire capabilities` both reported
  `1.14.0`. Telemetry was disabled for that check. No workspace was written.
