/**
 * First-run composition: one human, the agent they own, one workspace, one goal.
 *
 * Calls the existing bootstrap and service operations inside one store
 * transaction. Nested service transactions are savepoints, so a throw cannot
 * leave a partial onboarding workspace or a minted token. This does not
 * register an agent session and it does not start the server.
 */
import type { CampfireConfig } from "../config.js";
import { ValidationError } from "../domain/errors.js";
import type { ActorContext } from "../service/authorization.js";
import type { CampfireService } from "../service/service.js";
import type { CampfireStore } from "../store/store.js";
import { bootstrapOrganizationTeam } from "./bootstrap.js";

export interface OnboardInput {
  humanName: string;
  agentName: string;
  harness: string;
  workspaceName: string;
  goal: string;
}

export interface OnboardReceipt {
  databasePath: string;
  organization: { id: string; name: string };
  team: { id: string; name: string };
  human: { id: string; actorType: "human"; displayName: string; token: string };
  agent: {
    id: string;
    actorType: "agent";
    name: string;
    harness: string;
    humanId: string;
    token: string;
  };
  workspace: { id: string; name: string; status: string };
  goal: { id: string; title: string; status: string };
  next: {
    serve: string;
    harness: {
      env: ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS"];
      harness: string;
      workspaceId: string;
    };
    steps: ["register_agent_session", "preflight", "get_workspace_context"];
  };
}

const ALREADY_INITIALIZED =
  "This installation already has a human or a workspace. Use create-human, create-agent, create-workspace, create-goal, invite, and join.";

export function onboardInstallation(
  store: CampfireStore,
  service: CampfireService,
  config: CampfireConfig,
  input: OnboardInput,
): OnboardReceipt {
  return store.transaction(() => {
    if (store.countHumans() !== 0 || store.listWorkspaces().length !== 0) {
      throw new ValidationError(ALREADY_INITIALIZED, { field: "onboard" });
    }

    const boot = bootstrapOrganizationTeam(store, {
      organizationId: config.organization.id,
      organizationName: config.organization.name,
      teamId: config.team.id,
      teamName: config.team.name,
      createdAt: new Date().toISOString(),
    });
    const createdHuman = service.createHuman(undefined, {
      teamId: boot.teamId,
      displayName: input.humanName,
    });
    const humanCtx: ActorContext = {
      actor: { actorId: createdHuman.human.id, actorType: "human" },
    };
    const createdAgent = service.createAgent(humanCtx, {
      teamId: boot.teamId,
      humanId: createdHuman.human.id,
      name: input.agentName,
      harness: input.harness,
    });
    const workspace = service.createWorkspace(humanCtx, {
      teamId: boot.teamId,
      name: input.workspaceName,
    });
    const goal = service.createGoal(humanCtx, {
      workspaceId: workspace.id,
      title: input.goal,
    });
    service.inviteToWorkspace(humanCtx, {
      workspaceId: workspace.id,
      actor: { actorId: createdAgent.agent.id, actorType: "agent" },
      role: "agent",
    });
    const agentCtx: ActorContext = {
      actor: { actorId: createdAgent.agent.id, actorType: "agent" },
    };
    service.joinWorkspace(agentCtx, { workspaceId: workspace.id });
    const humanId = createdAgent.agent.humanId;
    if (humanId === undefined || humanId.length === 0) {
      throw new ValidationError("Agent has no owning human", { field: "humanId" });
    }

    return {
      databasePath: config.databasePath,
      organization: { id: boot.organizationId, name: config.organization.name },
      team: { id: boot.teamId, name: config.team.name },
      human: {
        id: createdHuman.human.id,
        actorType: "human",
        displayName: createdHuman.human.displayName,
        token: createdHuman.token,
      },
      agent: {
        id: createdAgent.agent.id,
        actorType: "agent",
        name: createdAgent.agent.name,
        harness: createdAgent.agent.harness,
        humanId,
        token: createdAgent.token,
      },
      workspace: { id: workspace.id, name: workspace.name, status: workspace.status },
      goal: { id: goal.id, title: goal.title, status: goal.status },
      next: {
        serve: `CAMPFIRE_DB=${config.databasePath} campfire serve`,
        harness: {
          env: ["CAMPFIRE_URL", "CAMPFIRE_TOKEN", "CAMPFIRE_HARNESS"],
          harness: input.harness,
          workspaceId: workspace.id,
        },
        steps: ["register_agent_session", "preflight", "get_workspace_context"],
      },
    };
  });
}

export function formatOnboardReceipt(receipt: OnboardReceipt): string {
  return [
    "Campfire onboarding receipt",
    "",
    `Database: ${receipt.databasePath}`,
    `Human: ${receipt.human.displayName} (${receipt.human.id})`,
    `Agent: ${receipt.agent.name} (${receipt.agent.id}), harness ${receipt.agent.harness}, owned by ${receipt.agent.humanId}`,
    `Workspace: ${receipt.workspace.name} (${receipt.workspace.id})`,
    `Goal: ${receipt.goal.title} (${receipt.goal.id})`,
    "",
    "Credentials (printed once):",
    `Human token — operator CLI / administration: ${receipt.human.token}`,
    `Agent token — exactly one harness process: ${receipt.agent.token}`,
    "",
    "Next steps:",
    `1. Start the server: ${receipt.next.serve}`,
    `2. Point one harness process at CAMPFIRE_URL, CAMPFIRE_TOKEN (the agent token printed above), and CAMPFIRE_HARNESS=${receipt.agent.harness}.`,
    "   Do not put an actor id in hosted auth. Do not use the human token for the harness.",
    `3. As that agent, call register_agent_session for workspace ${receipt.workspace.id}, then preflight, then read workspace context.`,
    "",
  ].join("\n");
}
