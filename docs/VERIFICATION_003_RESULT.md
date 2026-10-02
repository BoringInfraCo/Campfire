# Campfire — Verification 003 Result

**Classification:** Independent re-verification of the packaged Sprint 020 Viewer
**Date:** October 2, 2026
**Target:** Campfire `v1.9.0` candidate, packaged tarball `release/campfire-darwin-arm64.tar.gz`
**Gate status:** Not a new field or team trace. Gate B and Gate C are not evaluated.
**Evidence:** `evidence/verification-003/` (gitignored, private)

---

## 1. Scope and independence boundary

This pass was run independently after Verification 002 because the prior report
described the Viewer but did not leave the real Viewer visibly open for review.
It re-launched the packaged candidate, served the Verification 002 workspace
through the enrolled recipient's remote profile, inspected the rendered result
in a visible browser, and regenerated the screenshot and browser-isolation
evidence from scratch.

This is deliberately narrower than Verification 002. It reuses that run's real
workspace database and structured contributions; it does not claim a new join,
a new reciprocal contribution, a second human, or a second machine. Therefore it
does not change Sprint 020's **CONDITIONAL GO** and does not satisfy §16.

## 2. Candidate identity

The Viewer assets installed under `/tmp/cf-pack` matched the current source
assets byte for byte:

| Asset | SHA-256 |
| --- | --- |
| `index.html` | `ebb63bc2f8ac91ff36c7c217d4f6a4dc0e3b66f1d013cfb372cf3cabfd44b925` |
| `app.css` | `f1e3e1b19692960708c365b16f67a1e9eb3d515413aa76de89e05868317effab` |
| `app.js` | `802e8ff9ae2a410df48b6a90c2c5b1a31d2b1f8719ebdf183ad4b8b91abd4fd1` |

The packaged tarball SHA-256 was
`4246e44ba229d67a02f8a138bb519eb84b4aa99052736922681f417228da5f31`.
The run used Node `v22.23.2`, satisfying `engines.node >=22`.

## 3. Real Viewer result

The packaged local API was launched on `127.0.0.1:9601`; the enrolled recipient
profile (`Dana Teammate`) launched its read-only proxy Viewer on
`127.0.0.1:9603`. The Viewer was then opened visibly in the Codex in-app browser.

The rendered page showed:

- the recipient human in the masthead;
- all three humans and four agents in the participant rail;
- the goal and accepted Node 22 decision;
- the current Viewer-capture task;
- the complete workstream, including enrollment records, OpenCode's conflict
  finding, the teammate-opened reconciliation task, and the owner's resolution;
- an expanded inspect view whose detail explicitly credits the OpenCode teammate
  task and records both shell paths and Node versions.

`00-ENTIRE-viewer-unclipped.png` is the complete 1440×2200, 2× capture. Its
workstream had `clientHeight === scrollHeight === 1813`; orientation had
`clientHeight === scrollHeight === 267`. Nothing in either internal scroll
region was clipped.

`08-inspect-resolved-runtime.png` is the focused visual proof of reciprocal
continuation. It expands the owner's resolution and names the teammate's task,
the prior finding, the accepted decision, and the independent reproduction.

## 4. Browser and credential isolation

The fresh browser capture recorded 25 requests with:

- zero console errors;
- zero failed requests;
- zero `cft_` or `cfe_` matches in URLs, request bodies, served HTML, cookies,
  local storage, or session storage;
- zero `Authorization` headers;
- zero `Cookie` headers.

The only browser storage entries were the workspace id and the Viewer last-seen
contribution cursor. The human credential remained in the local backend process.

## 5. Fresh validation

| Check | Result |
| --- | --- |
| `npm run typecheck` under Node 22.23.2 | PASS |
| `npm test` under Node 22.23.2 | PASS — 55 files, 595 tests |
| Visible in-app browser inspection | PASS |
| Unclipped full Viewer capture | PASS |
| Resolved-runtime inspect expansion | PASS |
| Browser token/header scan | PASS |

The first test attempt ran inside a restricted listener sandbox and produced
`EPERM` failures for loopback and tsx IPC listeners. The identical suite was
rerun with listener permission and passed completely; the first result was an
execution-environment refusal, not a candidate failure.

## 6. Verdict

**GO for the Viewer re-verification.** The packaged candidate rendered the real
recipient-side workspace correctly, the full workstream was visually present
and unclipped, inspect expansion exposed the reciprocal-continuation detail, and
the browser boundary remained free of credentials.

**No change to the sprint verdict.** This pass reused Verification 002's same-
machine, one-human rehearsal data and does not create the independent §16 team
trace. Sprint 020 remains **CONDITIONAL GO**.
