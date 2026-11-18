/**
 * Shared body digest and identifier checks for idempotent create_workspace.
 * The digest covers team, name, and description only. It is not a credential.
 */
import { Conflict, ValidationError } from "../domain/errors.js";

export interface WorkspaceCreateBody {
  teamId: string;
  name: string;
  description?: string;
}

const REQUEST_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export function readOptionalIdentifier(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, { field });
  }
  const trimmed = value.trim();
  if (!REQUEST_ID.test(trimmed)) {
    throw new ValidationError(`Invalid ${field}`, { field });
  }
  return trimmed;
}

/** Stable digest input. Key order is part of the digest. */
export function workspaceCreateBody(input: WorkspaceCreateBody): string {
  return JSON.stringify({
    teamId: input.teamId,
    name: input.name,
    description: input.description ?? null,
  });
}

export function workspaceCreateRequestConflict(): Conflict {
  return new Conflict(
    "This requestId was already used with a different team, name, or description",
    {
      field: "requestId",
      recovery: "Retry the same teamId, name, and description, or choose a new requestId.",
    },
  );
}

export function workspaceCreateDisagreement(): Conflict {
  return new Conflict("requestId and workspaceId do not name the same workspace", {
    field: "requestId",
  });
}
