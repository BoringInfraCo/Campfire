/**
 * Agent-readable setup facts.
 *
 * This is documentation for the installed binary. It does not create domain
 * state and it never includes a bearer token. The one-time onboard receipt
 * remains the only credential delivery.
 */
import { installedCampfireVersion } from "./version.js";

export const SETUP_AGENT_STEPS = ["register_agent_session", "preflight", "get_workspace_context"] as const;

export const SETUP_HANDOFF_FIELDS = [
  "version",
  "workspaceName",
  "workspaceId",
  "goalTitle",
  "humanName",
  "agentName",
  "readiness",
  "viewerUrl",
  "reloadOrApproval",
  "nextAction",
] as const;

export interface SetupContract {
  version: string;
  inputs: ["human-name", "agent-name", "harness", "workspace-name", "goal"];
  credentials: {
    human: "operator CLI / administration";
    agent: "exactly one harness process";
    handoff: "no credential";
  };
  databasePath?: string;
  workspaceId?: string;
  serve: {
    command: string;
    env: ["CAMPFIRE_DB"];
    urlEnv: "CAMPFIRE_URL";
  };
  mcp: {
    command: "campfire";
    args: ["mcp"];
    env: ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS"];
    token: "agent";
    harness?: string;
  };
  agentSteps: typeof SETUP_AGENT_STEPS;
  viewer: {
    command: "campfire view";
    bind: "loopback";
    tokenInBrowser: false;
  };
  reloadRequired: true;
  approvalMayBeRequired: true;
  handoffFields: typeof SETUP_HANDOFF_FIELDS;
}

export function setupContract(options?: {
  databasePath?: string;
  workspaceId?: string;
  harness?: string;
  serveCommand?: string;
}): SetupContract {
  const contract: SetupContract = {
    version: installedCampfireVersion(),
    inputs: ["human-name", "agent-name", "harness", "workspace-name", "goal"],
    credentials: {
      human: "operator CLI / administration",
      agent: "exactly one harness process",
      handoff: "no credential",
    },
    serve: {
      command: options?.serveCommand ?? "CAMPFIRE_DB=<database path> campfire serve",
      env: ["CAMPFIRE_DB"],
      urlEnv: "CAMPFIRE_URL",
    },
    mcp: {
      command: "campfire",
      args: ["mcp"],
      env: ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS"],
      token: "agent",
    },
    agentSteps: SETUP_AGENT_STEPS,
    viewer: { command: "campfire view", bind: "loopback", tokenInBrowser: false },
    reloadRequired: true,
    approvalMayBeRequired: true,
    handoffFields: SETUP_HANDOFF_FIELDS,
  };
  if (options?.databasePath !== undefined) contract.databasePath = options.databasePath;
  if (options?.workspaceId !== undefined) contract.workspaceId = options.workspaceId;
  if (options?.harness !== undefined) contract.mcp.harness = options.harness;
  return contract;
}
