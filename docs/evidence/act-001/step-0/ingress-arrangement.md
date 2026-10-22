# Test-host ingress arrangement (ACT-001 §1 item 6)

**Label: FIXTURE EVIDENCE.** Arrangement for native signed-webhook tests. No live provider run is authorized in Step 0.

## Isolation rules (frozen)

1. Isolated fixtures MUST NOT rewrite real harness profiles (`~/.codex`, `~/.config/opencode`, or equivalents).
2. Isolated fixtures MUST NOT start the normal `campfire up` profile (loopback listener + Viewer + stored credentials).
3. Isolated fixture runs MUST NOT use production credentials (`CAMPFIRE_TOKEN`, bridge tokens, or any real GitHub credential).
4. Isolated fixture runs MUST NOT mutate a public repository. The only mutation target ever permitted is the dedicated synthetic test repository in `pilot-allowlist.json`.
5. A test driver submits at most once against a specifically authorized test repository; it is not installed as a daemon or a generic product runner.

## Real-provider test gate

A real verification retry plus its matching native GitHub webhook requires ALL of:

- a dedicated test target (repository + workflow from the frozen allowlist, or a stricter dedicated pair),
- explicit operator authorization for that exact action (repo, workflow, run, attempt, SHA),
- the operator's own isolated credential, never shared with a harness.

Status: **NOT AUTHORIZED.** No operator authorization is recorded in Step 0.
A signed synthetic payload validates the ingress contract only; it does not
establish provider interoperability. Missing authorization is not a defect in
the fixtures; it is the gate working.
