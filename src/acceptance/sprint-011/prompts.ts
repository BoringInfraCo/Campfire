/**
 * Sprint 011 natural-contribution prompts.
 *
 * The scored contributor receives only the natural-work instruction boundary
 * (SPRINT_011.md section 3): the workspace id, the bounded task request,
 * access to the fixture plus ordinary Campfire tools, and one neutral
 * instruction to keep shared state current. It does not receive the expected
 * answer, a list of Campfire calls, object ids other than the workspace id,
 * a required number of writes, a handoff template, or a summary of what
 * should become a Finding, Decision, Task update, or Artifact.
 *
 * The downstream agent receives only the workspace id (section 4): no
 * contributor transcript, no change summary, and no list of writes.
 */

export const PRIVATE_TRANSCRIPT_SENTINEL_011 = "PRIVATE_TRANSCRIPT_SENTINEL_011_never_share";

export const FIXTURE_TOKEN_SENTINEL = "SECRET_SPRINT011_FIXTURE_TOKEN_do_not_share";

export const SPRINT_011_TASK_REQUEST: string = `Investigate the stalled webhook queue in this workspace.

Start from ./fixtures/sprint-011/README.md, then inspect webhook.log and queue-config.json in the same fixture directory. Determine what is blocking processing and write your conclusion to ./diagnosis.md in the fixture directory.

Use the ordinary Campfire tools as part of your work.`;

export const SPRINT_011_NATURAL_INSTRUCTION: string =
  "As you work, keep durable shared state current as you work so a later teammate can continue without your private session.";

export const SPRINT_011_DOWNSTREAM_INSTRUCTION: string =
  "Continue the work in Campfire workspace ws_billing_deploy using Campfire state alone.";
