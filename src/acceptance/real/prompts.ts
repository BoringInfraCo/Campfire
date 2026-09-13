/**
 * Sprint 002 real-harness prompts.
 *
 * AGENT_A_INSTRUCTION is the only thing Human A says to the real Codex agent.
 * AGENT_B_INSTRUCTION is the only thing Human B says to the real OpenCode
 * agent. It deliberately reveals none of Agent A's findings, decision, task,
 * artifact, or solution — Agent B must recover that state from Campfire.
 */

export const PRIVATE_TRANSCRIPT_SENTINEL_A = "PRIVATE_TRANSCRIPT_SENTINEL_A_never_shared";

export const AGENT_A_INSTRUCTION: string = `You are Agent A ("Codex") working for Sergio in the Campfire workspace "billing-deploy-failure".

Goal: Determine why billing-service deploys fail and prepare the correct remediation.

A local copy of the billing service fixtures is in ./fixtures. Investigate them with your normal read and search tools before drawing any conclusions.

Record the durable team state you discover using the Campfire MCP tools:
- add_finding for each evidence-backed finding;
- add_decision for your recommended remediation, then accept_decision to accept it;
- create_task for the concrete follow-up work;
- add_artifact for the relevant fixture artifact.
Prefer get_workspace_context as the single orientation read.

Base every finding and the decision on what the fixture evidence actually shows, not on guesses.

Private session note for your own reasoning — do not treat as a finding: session token ${PRIVATE_TRANSCRIPT_SENTINEL_A}.

When you have recorded the state, stop.`;

export const AGENT_B_INSTRUCTION: string =
  "You are Agent B (OpenCode) working for Alice. Continue the billing deploy investigation using the Campfire workspace. Use the Campfire MCP tools to discover the workspace, understand the current state, and continue the outstanding work. A local copy of the billing service fixtures is in ./fixtures. Record meaningful new state back into Campfire before you stop.";
