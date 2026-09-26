/**
 * Human-first startup.
 *
 * The human is recorded once. Agents are created when a validated harness is
 * installed on this machine. Workspaces and goals are not invented here; the
 * connected agent creates them when work starts. Past private sessions are
 * not read.
 */
import type { CampfireConfig } from "../config.js";
import { ValidationError } from "../domain/errors.js";
import type { ActorContext } from "../service/authorization.js";
import type { CampfireService } from "../service/service.js";
import type { CampfireStore } from "../store/store.js";
import { bootstrapOrganizationTeam } from "./bootstrap.js";
import { prepareConnection, type SupportedHarness } from "./connect.js";

const ALREADY_HAS_HUMAN =
  "This installation already has a human. Run campfire up, or use create-agent, create-workspace, and create-goal.";

const HARNESS_NAME: Record<SupportedHarness, string> = {
  codex: "Codex",
  opencode: "OpenCode",
};

export interface ListeningHuman {
  humanId: string;
  humanName: string;
  teamId: string;
  token: string;
  databasePath: string;
}

export interface ConnectedAgent {
  harness: SupportedHarness;
  agentId: string;
  name: string;
  /** Present when this call minted the token. Absent when the agent already existed. */
  token?: string;
  created: boolean;
}

export function beginHuman(
  store: CampfireStore,
  service: CampfireService,
  config: CampfireConfig,
  humanName: string,
): ListeningHuman {
  const trimmed = humanName.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Your name is required", { field: "human-name" });
  }
  if (store.countHumans() !== 0) {
    throw new ValidationError(ALREADY_HAS_HUMAN, { field: "human-name" });
  }
  const boot = bootstrapOrganizationTeam(store, {
    organizationId: config.organization.id,
    organizationName: config.organization.name,
    teamId: config.team.id,
    teamName: config.team.name,
    createdAt: new Date().toISOString(),
  });
  const created = service.createHuman(undefined, {
    teamId: boot.teamId,
    displayName: trimmed,
  });
  return {
    humanId: created.human.id,
    humanName: created.human.displayName,
    teamId: boot.teamId,
    token: created.token,
    databasePath: config.databasePath,
  };
}

export function ensureHarnessAgents(
  store: CampfireStore,
  service: CampfireService,
  human: { id: string; teamId: string },
  harnesses: readonly SupportedHarness[],
  knownTokens: Readonly<Record<string, string | undefined>>,
): ConnectedAgent[] {
  const ctx: ActorContext = { actor: { actorId: human.id, actorType: "human" } };
  const existing = store.listAgents(human.teamId).filter((agent) => agent.humanId === human.id);
  return harnesses.map((harness) => {
    const found = existing.find((agent) => agent.harness === harness);
    if (found !== undefined) {
      const token = knownTokens[harness];
      return {
        harness,
        agentId: found.id,
        name: found.name,
        created: false,
        ...(token === undefined ? {} : { token }),
      };
    }
    const created = service.createAgent(ctx, {
      teamId: human.teamId,
      humanId: human.id,
      name: HARNESS_NAME[harness],
      harness,
    });
    return {
      harness,
      agentId: created.agent.id,
      name: created.agent.name,
      token: created.token,
      created: true,
    };
  });
}

export interface ConnectInstalledInput {
  store: CampfireStore;
  service: CampfireService;
  human: { id: string; teamId: string };
  harnesses: readonly SupportedHarness[];
  knownTokens: Readonly<Record<string, string | undefined>>;
  url: string;
  mcpCommand: string;
  workspaceId?: string;
  configPathFor: (harness: SupportedHarness) => string;
  /** Called when this connection mints a token. Callers store it; they do not print it. */
  onMintedToken: (harness: SupportedHarness, token: string) => void;
}

export interface ConnectInstalledResult {
  agents: ConnectedAgent[];
  /** Display names whose MCP block was written. */
  connected: string[];
}

export function connectInstalledHarnesses(input: ConnectInstalledInput): ConnectInstalledResult {
  const agents = ensureHarnessAgents(
    input.store,
    input.service,
    input.human,
    input.harnesses,
    input.knownTokens,
  );
  const connected: string[] = [];
  for (const agent of agents) {
    if (agent.created && agent.token !== undefined) {
      input.onMintedToken(agent.harness, agent.token);
    }
    if (agent.token === undefined) continue;
    prepareConnection({
      harness: agent.harness,
      configPath: input.configPathFor(agent.harness),
      mcpCommand: input.mcpCommand,
      url: input.url,
      agentToken: agent.token,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    });
    connected.push(agent.name);
  }
  return { agents, connected };
}
