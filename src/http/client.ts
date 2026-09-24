/**
 * HTTP client for a Campfire hosted instance.
 *
 * Used by the CLI and the MCP stdio adapter when CAMPFIRE_URL is set. The
 * bearer token is the actor; callers never send an acting actor id.
 */
import { CampfireError, ValidationError, type CampfireErrorCode } from "../domain/errors.js";

const KNOWN_CODES: ReadonlySet<string> = new Set<CampfireErrorCode>([
  "ValidationError",
  "WorkspaceNotFound",
  "ActorNotFound",
  "SessionNotFound",
  "TeamNotFound",
  "Unauthorized",
  "ParticipantRequired",
  "InvalidTransition",
  "InvalidContribution",
  "ArtifactNotFound",
  "TaskNotFound",
  "GoalNotFound",
  "FindingNotFound",
  "DecisionNotFound",
  "CrossWorkspaceReference",
  "Conflict",
]);

export interface CampfireHttpCallOptions {
  baseUrl: string;
  token: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface CampfireHttpSuccess<T = unknown> {
  ok: true;
  result: T;
}

export interface CampfireHttpFailure {
  ok: false;
  error: string;
  message: string;
}

export type CampfireHttpResponse<T = unknown> = CampfireHttpSuccess<T> | CampfireHttpFailure;

function callUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/call`;
}

function asCode(value: string): CampfireErrorCode {
  return KNOWN_CODES.has(value) ? (value as CampfireErrorCode) : "ValidationError";
}

export function hostedPreflightError(error: CampfireError): CampfireError {
  switch (error.code) {
    case "ValidationError":
      return new CampfireError(
        error.code,
        "Hosted Campfire preflight request is invalid; provide a workspace ID and valid preflight arguments",
        { field: "workspaceId" },
      );
    case "WorkspaceNotFound":
      return new CampfireError(error.code, "The requested Campfire workspace was not found; verify the workspace ID");
    case "ParticipantRequired":
      return new CampfireError(
        error.code,
        "The authenticated actor is not a participant in the requested workspace; request an invite before preflight",
      );
    case "SessionNotFound":
      return new CampfireError(
        error.code,
        "The configured agent session is unavailable; register an active session for the requested workspace",
        { nextAction: "register_agent_session" },
      );
    case "Unauthorized":
      return new CampfireError(
        error.code,
        "Hosted Campfire could not authenticate a ready agent session; verify CAMPFIRE_TOKEN and register an active session for the requested workspace",
        { nextAction: "register_agent_session" },
      );
    case "ActorNotFound":
      return new CampfireError(error.code, "The configured Campfire actor is unavailable; verify CAMPFIRE_TOKEN");
    default:
      return new CampfireError(
        error.code,
        "Hosted Campfire preflight failed; verify the endpoint, token, workspace access, and agent-session registration",
      );
  }
}

export function hostedIdentityError(error: CampfireError): CampfireError {
  switch (error.code) {
    case "Unauthorized":
    case "ActorNotFound":
      return new CampfireError(
        error.code,
        "Hosted Campfire could not authenticate the configured token; verify CAMPFIRE_TOKEN",
        { nextAction: "verify_campfire_token" },
      );
    case "ValidationError":
      return new CampfireError(
        error.code,
        "Hosted Campfire identity startup was rejected; verify CAMPFIRE_URL, CAMPFIRE_TOKEN, and MCP identity options",
      );
    default:
      return new CampfireError(
        error.code,
        "Hosted Campfire identity startup failed; verify the endpoint, token, and MCP identity options",
      );
  }
}

export async function campfireHttpCall<T = unknown>(options: CampfireHttpCallOptions): Promise<T> {
  const response = await fetch(callUrl(options.baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ method: options.method, params: options.params ?? {} }),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ValidationError(
      `Campfire HTTP ${response.status}: response was not JSON`,
      { status: response.status },
    );
  }

  if (typeof payload !== "object" || payload === null) {
    throw new ValidationError("Campfire HTTP response was not an object");
  }
  const body = payload as CampfireHttpResponse<T>;
  if (body.ok === true) {
    return body.result;
  }
  if (body.ok === false) {
    throw new CampfireError(asCode(body.error), body.message, { httpStatus: response.status });
  }
  throw new ValidationError("Campfire HTTP response was missing ok");
}
