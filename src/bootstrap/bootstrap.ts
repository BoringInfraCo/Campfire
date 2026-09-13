/**
 * Initial org/team bootstrap for a blank database.
 *
 * Kept separate from the demo `seedFixture` (which inserts labeled demo
 * humans, agents, and workspaces). Bootstrap only ensures the organization
 * and team rows exist so `create-human` can run on a blank DB:
 * `init -> bootstrap -> create-human`.
 */
import { ValidationError } from "../domain/errors.js";
import type { CampfireStore } from "../store/store.js";

export interface BootstrapInput {
  organizationId: string;
  organizationName: string;
  teamId: string;
  teamName: string;
  createdAt: string;
}

export interface BootstrapResult {
  organizationId: string;
  teamId: string;
  created: { organization: boolean; team: boolean };
}

export function bootstrapOrganizationTeam(
  store: CampfireStore,
  input: BootstrapInput,
): BootstrapResult {
  let createdOrganization = false;
  let createdTeam = false;

  if (store.getOrganization(input.organizationId) === undefined) {
    store.createOrganization({
      id: input.organizationId,
      name: input.organizationName,
      createdAt: input.createdAt,
    });
    createdOrganization = true;
  }

  const existingTeam = store.getTeam(input.teamId);
  if (existingTeam === undefined) {
    store.createTeam({
      id: input.teamId,
      organizationId: input.organizationId,
      name: input.teamName,
      createdAt: input.createdAt,
    });
    createdTeam = true;
  } else if (existingTeam.organizationId !== input.organizationId) {
    throw new ValidationError(
      `Team ${input.teamId} already belongs to organization ${existingTeam.organizationId}, not ${input.organizationId}`,
      { field: "team", teamId: input.teamId },
    );
  }

  return {
    organizationId: input.organizationId,
    teamId: input.teamId,
    created: { organization: createdOrganization, team: createdTeam },
  };
}
