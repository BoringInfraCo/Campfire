/**
 * Session-start pull (Sprint 018).
 *
 * MCP clients may show this to the model when the session connects. It asks
 * the agent to read the workspace before acting. It does not register a
 * session, and it does not schedule work.
 */
export const SESSION_INSTRUCTIONS = [
  "Before editing or answering about the work, call list_workspaces.",
  "If a workspace is listed, call get_workspace_context and use its goal, open tasks, findings, decisions, and needsYou.",
  "If none is listed, continue the human's task. Create a workspace only when the work needs one. Do not invent one at startup.",
  "Before creating or updating a goal, finding, decision, task, artifact, or workspace, call register_agent_session.",
  "Starting this server does not register a session.",
  "Do not treat suggestedNextAction as an order to act, schedule another agent, or write on exit.",
  "If a tool error says to run campfire up, tell the human. Do not start the server yourself.",
  "To inspect Campfire from a shell instead of MCP, run campfire capabilities --output json or campfire status --output json.",
  "get_workspace_context is a bounded orientation, truncated slices are signaled, and list_decisions, list_findings, list_tasks, list_artifacts, get_decision, get_finding, get_task, get_artifact, and get_workspace_changes are how to drill down or catch up.",
  "correct_finding, withdraw_finding, cite_finding_evidence, remove_finding_evidence, cite_decision_basis, remove_decision_basis, and retire_decision record a new correction or an explicit transition and do not edit the old assertion. list_findings currentness is current, superseded, withdrawn, or all. add_decision replacesDecisionId and accept_decision reason do not edit the old assertion.",
].join(" ");
