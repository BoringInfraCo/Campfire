# ACT-001 client procedure

**Label: FIXTURE EVIDENCE.** Isolated procedure for the synthetic verification
retry. Not live GitHub, not a Campfire `execute`/`run` endpoint, and not a
product daemon. The stub in `github-rerun-stub.ts` is the only simulated
provider authority in tests.

Campfire records intent, human approval, one dispatch reservation, submission
receipts, and cited signed observations. The **external client** owns the GitHub
credential, validates the allowlisted target, and submits at most once.
Campfire stores none of that credential.

## Procedure

1. **Propose** via CLI or MCP (`propose_action` / `campfire actions propose`).
   The designated executor, exact repository/workflow/run/SHA/`expectedAttempt`,
   cited task/evidence, and reason are immutable after this call.

2. **Human owner approves via CLI only.**
   `campfire actions approve <id> --workspace <id> --revision <n> --digest <sha256> --request-key <key>`
   There is no MCP `review_action`, no browser approval, and no agent-mediated
   human token. Reject with `--reason` instead of approving. Direct `/v1/call`
   with an agent token must fail this method.

3. **Designated executor reserves** via CLI or MCP
   (`reserve_action_execution` / `campfire actions reserve`).
   Campfire returns the approved intent, not a GitHub credential or a script.
   One reservation exists per exact provider target/attempt.

4. **Client validates, then submits once with its own credential.**
   Recheck the allowlisted repository/workflow, full SHA, failed completed run,
   and `observedAttempt + 1 === expectedAttempt`. Then POST
   `/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs`
   (GitHub REST `2022-11-28`). Tests use `github-rerun-stub.ts`. Stop on drift.
   **Never POST twice because a response was lost.**

5. **Record the submission outcome** via CLI or MCP (`record_action_outcome`):
   - `accepted` — provider accepted the request. Not proof tests passed.
   - `definite_failure` — no dispatch occurred.
   - `unknown` — timeout or lost response; inspect the exact run/attempt.
   A later reconciliation receipt may resolve `unknown`; it does not erase it.

6. **Signed completion is a separate observation.**
   A valid `workflow_run` `completed` webhook on
   `POST /v1/integrations/github/:sourceId` may arrive before or after step 5.
   Reservation correlation is enough. The Finding/Artifact pair is provider
   evidence, not an executor assertion. Only provider `success` is verification
   success; `failure` stays failure.

## What Campfire does not do

- No `execute`, `run`, or GitHub dispatch HTTP/MCP method.
- No stored GitHub token, outbound GitHub call, watcher, or retry loop.
- No automatic second POST, task completion, or accepted decision.

## Isolation

Do not rewrite `~/.codex` or `~/.config/opencode`, start `campfire up`, use
production credentials, or mutate a public repository. A real-provider run
requires a dedicated test target and explicit operator authorization; Step 0
records that as **NOT AUTHORIZED**.
