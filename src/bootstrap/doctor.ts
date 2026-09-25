/**
 * Read-only setup diagnosis.
 *
 * Reports the first failed boundary and a stable next action. It calls the
 * existing readiness check; it does not register a session, mint a token, or
 * write collaboration state.
 */
import { CampfireError } from "../domain/errors.js";
import type { CampfireRuntime } from "../runtime.js";
import { installedCampfireVersion } from "./version.js";

export interface DoctorCheck {
  id: string;
  pass: boolean;
  nextAction: string | null;
}

export interface DoctorReport {
  ready: boolean;
  version: string;
  mode: "local" | "hosted";
  checks: DoctorCheck[];
  nextAction: string;
}

function report(mode: "local" | "hosted", checks: DoctorCheck[]): DoctorReport {
  const failed = checks.find((check) => !check.pass);
  return {
    ready: failed === undefined,
    version: installedCampfireVersion(),
    mode,
    checks,
    nextAction: failed?.nextAction ?? "start_campfire_view",
  };
}

function pass(id: string): DoctorCheck {
  return { id, pass: true, nextAction: null };
}

function fail(id: string, nextAction: string): DoctorCheck {
  return { id, pass: false, nextAction };
}

export function diagnoseLocal(
  runtime: CampfireRuntime,
  input: { workspaceId: string; harness: string; token: string | undefined },
): DoctorReport {
  const checks: DoctorCheck[] = [pass("version"), pass("mode")];
  if (input.token === undefined || input.token.trim().length === 0) {
    checks.push(fail("token", "set_agent_token"));
    return report("local", checks);
  }
  let actor;
  try {
    actor = runtime.service.resolveToken(input.token);
  } catch {
    checks.push(fail("token", "set_agent_token"));
    return report("local", checks);
  }
  checks.push(pass("token"));
  if (actor.actorType !== "agent") {
    checks.push(fail("actor", "use_agent_token"));
    return report("local", checks);
  }
  checks.push(pass("actor"));

  const workspace = runtime.store.getWorkspace(input.workspaceId);
  if (workspace === undefined) {
    checks.push(fail("workspace", "workspace_not_found"));
    return report("local", checks);
  }
  if (runtime.store.getParticipant(input.workspaceId, actor) === undefined) {
    checks.push(fail("workspace", "not_a_participant"));
    return report("local", checks);
  }
  checks.push(pass("workspace"));

  const sessions = runtime.store
    .listAgentSessions(input.workspaceId)
    .filter((session) => session.agentId === actor.actorId && session.endedAt === undefined);
  const matched = sessions.find((session) => session.harness === input.harness);
  if (matched === undefined && sessions.length > 0) {
    checks.push(fail("harness", "harness_mismatch"));
    return report("local", checks);
  }
  if (matched === undefined) {
    checks.push(fail("session", "register_agent_session"));
    return report("local", checks);
  }
  checks.push(pass("harness"));
  checks.push(pass("session"));

  try {
    runtime.service.checkReadiness(
      { actor, agentSessionId: matched.id },
      { workspaceId: input.workspaceId },
    );
    checks.push(pass("preflight"));
  } catch {
    checks.push(fail("preflight", "register_agent_session"));
    return report("local", checks);
  }
  try {
    runtime.service.getWorkspaceContext({ actor, agentSessionId: matched.id }, input.workspaceId);
    checks.push(pass("context"));
  } catch {
    checks.push(fail("context", "get_workspace_context"));
    return report("local", checks);
  }
  return report("local", checks);
}

export interface HostedDoctorCall {
  (method: string, params: Record<string, unknown>): Promise<unknown>;
}

const PASS_SESSION = "register_agent_session_then_pass_session";

/**
 * A separate CLI process does not share the MCP process's in-memory session.
 * Hosted diagnosis only knows the session id the caller passes in.
 */
function withSession(
  params: Record<string, unknown>,
  sessionId: string | undefined,
): Record<string, unknown> {
  if (sessionId === undefined) return params;
  return { ...params, agentSessionId: sessionId };
}

function hostedFailure(error: unknown, sessionWasSupplied: boolean): DoctorCheck {
  if (!(error instanceof CampfireError)) return fail("endpoint", "start_campfire_serve");
  if (error.code === "WorkspaceNotFound") return fail("workspace", "workspace_not_found");
  if (error.code === "ParticipantRequired") return fail("workspace", "not_a_participant");
  if (error.code === "SessionNotFound") return fail("session", "unknown_session");
  if (error.code === "ActorNotFound" || error.code === "Unauthorized" && error.message.includes("CAMPFIRE_TOKEN")) {
    return fail("token", "set_agent_token");
  }
  if (error.code === "Unauthorized") {
    if (error.message.includes("does not belong")) return fail("session", "session_wrong_actor");
    if (error.message.includes("belongs to workspace")) return fail("session", "session_wrong_workspace");
    if (error.message.includes("has ended")) return fail("session", "session_ended");
    if (!sessionWasSupplied) return fail("session", PASS_SESSION);
  }
  return fail("session", sessionWasSupplied ? "unknown_session" : PASS_SESSION);
}

interface ActivityItem {
  action?: string;
  objectType?: string;
  objectId?: string;
  payload?: { harness?: string };
}

export async function diagnoseHosted(
  call: HostedDoctorCall,
  input: { workspaceId: string; harness: string; reachable: boolean; sessionId?: string },
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [pass("version")];
  if (!input.reachable) {
    checks.push(fail("endpoint", "start_campfire_serve"));
    return report("hosted", checks);
  }
  checks.push(pass("endpoint"));
  const sessionId = input.sessionId?.trim();
  const supplied = sessionId !== undefined && sessionId.length > 0 ? sessionId : undefined;
  let who: { actor?: { actorType?: string; actorId?: string } };
  try {
    who = (await call("whoami", withSession({}, supplied))) as { actor?: { actorType?: string; actorId?: string } };
  } catch (error) {
    const code = error instanceof CampfireError ? error.code : "";
    checks.push(fail("token", code === "Unauthorized" || code === "ActorNotFound" ? "set_agent_token" : "start_campfire_serve"));
    return report("hosted", checks);
  }
  checks.push(pass("token"));
  if (who.actor?.actorType !== "agent" || who.actor.actorId === undefined) {
    checks.push(fail("actor", "use_agent_token"));
    return report("hosted", checks);
  }
  checks.push(pass("actor"));

  if (supplied === undefined) {
    try {
      await call("preflight", { workspaceId: input.workspaceId });
    } catch (error) {
      checks.push(hostedFailure(error, false));
      return report("hosted", checks);
    }
    // An agent preflight without a session id cannot be ready. The server may
    // still have a session this process was not told about.
    checks.push(fail("session", PASS_SESSION));
    return report("hosted", checks);
  }

  let context: { goal?: { title?: string }; provenance?: ActivityItem[] };
  try {
    context = (await call(
      "get_workspace_context",
      withSession({ workspaceId: input.workspaceId }, supplied),
    )) as { goal?: { title?: string }; provenance?: ActivityItem[] };
  } catch (error) {
    checks.push(hostedFailure(error, true));
    return report("hosted", checks);
  }
  if (context.goal?.title === undefined) {
    checks.push(fail("context", "get_workspace_context"));
    return report("hosted", checks);
  }
  checks.push(pass("workspace"));
  checks.push(pass("context"));

  let activity: { items?: ActivityItem[] };
  try {
    activity = (await call("get_activity", withSession({ workspaceId: input.workspaceId }, supplied))) as {
      items?: ActivityItem[];
    };
  } catch (error) {
    checks.push(hostedFailure(error, true));
    return report("hosted", checks);
  }
  const registered = (activity.items ?? []).find(
    (item) => item.action === "register_session" && item.objectId === supplied,
  );
  if (registered?.payload?.harness !== input.harness) {
    checks.push(fail("harness", "harness_mismatch"));
    return report("hosted", checks);
  }
  checks.push(pass("harness"));
  checks.push(pass("session"));

  try {
    await call("preflight", withSession({ workspaceId: input.workspaceId }, supplied));
    checks.push(pass("preflight"));
  } catch (error) {
    checks.push(hostedFailure(error, true));
    return report("hosted", checks);
  }
  return report("hosted", checks);
}
