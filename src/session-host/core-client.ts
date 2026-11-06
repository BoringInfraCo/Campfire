/**
 * Core client for the local session host.
 *
 * The real adapter calls CamelCase methods on a Campfire service object when
 * they exist. HTTP uses the snake_case method names below. Neither path puts
 * the agent credential into argv, the registry, or an error string.
 */
import { randomBytes } from "node:crypto";
import { CampfireError, ValidationError } from "../domain/errors.js";
import { campfireHttpCall } from "../http/client.js";
import {
  RUNTIME_REPORT_MISSING_MESSAGE,
  type AgentSessionListInput,
  type AgentSessionListPage,
  type CoreClient,
  type ListedAgentSession,
  type RegisterAgentSessionInput,
  type RegisteredAgentSession,
  type RuntimeReport,
  type RuntimeReportInput,
  type SessionActorContext,
} from "./types.js";

export const HTTP_METHODS = {
  register: "register_agent_session",
  report: "report_agent_session_runtime",
  end: "end_agent_session",
  list: "list_agent_sessions",
} as const;

type ServiceMethod = (...args: unknown[]) => unknown;

function method(service: object, name: string): ServiceMethod | undefined {
  const value = (service as Record<string, unknown>)[name];
  return typeof value === "function" ? (value as ServiceMethod) : undefined;
}

function requireMethod(service: object, name: string, message?: string): ServiceMethod {
  const fn = method(service, name);
  if (fn === undefined) {
    throw new ValidationError(message ?? `Campfire Core has no ${name} method. The session host cannot continue until that method exists.`, {
      field: name,
      nextAction: "upgrade_campfire_core",
    });
  }
  return fn;
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let next = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    next = next.split(secret).join("[redacted]");
  }
  return next;
}

function rethrowRedacted(error: unknown, secrets: readonly string[]): never {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof CampfireError ? error.details : undefined;
  const blob = details === undefined ? message : `${message} ${JSON.stringify(details)}`;
  if (redactSecrets(blob, secrets) !== blob) {
    throw new ValidationError("Campfire rejected the session host request.", { field: "credentials" });
  }
  throw error;
}

async function callMethod(fn: ServiceMethod, args: unknown[], secrets: readonly string[]): Promise<unknown> {
  try {
    return await fn(...args);
  } catch (error) {
    rethrowRedacted(error, secrets);
  }
}

export interface ServiceCoreBinding {
  agent: SessionActorContext;
  reader: SessionActorContext;
  secrets?: readonly string[];
}

/**
 * Binds one service object. Throws immediately when runtime reporting is absent
 * so a launch cannot register a session it can never heartbeat.
 */
export function createServiceCoreClient(service: object, binding: ServiceCoreBinding): CoreClient {
  const report = requireMethod(service, "reportAgentSessionRuntime", RUNTIME_REPORT_MISSING_MESSAGE);
  const register = requireMethod(service, "registerAgentSession");
  const end = requireMethod(service, "endAgentSession");
  const list = requireMethod(service, "listAgentSessions");
  const secrets = binding.secrets ?? [];
  return {
    async registerAgentSession(agentCtx, input) {
      const ctx = agentCtx.actor.actorId.length > 0 ? agentCtx : binding.agent;
      return (await callMethod(register, [ctx, input], secrets)) as RegisteredAgentSession;
    },
    async reportAgentSessionRuntime(agentCtx, input) {
      const ctx = agentCtx.agentSessionId === undefined ? { ...agentCtx, agentSessionId: input.sessionId } : agentCtx;
      return (await callMethod(report, [ctx, input], secrets)) as RuntimeReport;
    },
    async endAgentSession(agentCtx, sessionId) {
      await callMethod(end, [agentCtx, sessionId], secrets);
    },
    async listAgentSessions(readerCtx, input) {
      const ctx = readerCtx.actor.actorId.length > 0 ? readerCtx : binding.reader;
      return (await callMethod(list, [ctx, input], secrets)) as AgentSessionListPage;
    },
  };
}

export interface HttpCoreOptions {
  baseUrl: string;
  agentToken: string;
  humanToken: string;
  call?: (options: { baseUrl: string; token: string; method: string; params?: Record<string, unknown> }) => Promise<unknown>;
}

export function createHttpCoreClient(options: HttpCoreOptions): CoreClient {
  const call = options.call ?? ((request) => campfireHttpCall(request));
  const secrets = [options.agentToken, options.humanToken];
  const agentCtx: SessionActorContext = { actor: { actorId: "agent", actorType: "agent" } };
  const readerCtx: SessionActorContext = { actor: { actorId: "human", actorType: "human" } };
  async function invoke<T>(token: string, methodName: string, params: Record<string, unknown>): Promise<T> {
    try {
      return (await call({ baseUrl: options.baseUrl, token, method: methodName, params })) as T;
    } catch (error) {
      rethrowRedacted(error, secrets);
    }
  }
  return {
    registerAgentSession(_agentCtx, input) {
      return invoke(options.agentToken, HTTP_METHODS.register, { ...input });
    },
    reportAgentSessionRuntime(_agentCtx, input) {
      return invoke(options.agentToken, HTTP_METHODS.report, { ...input });
    },
    async endAgentSession(_agentCtx, sessionId) {
      await invoke(options.agentToken, HTTP_METHODS.end, { sessionId });
    },
    listAgentSessions(_readerCtx, input) {
      return invoke(options.humanToken, HTTP_METHODS.list, {
        workspaceId: input.workspaceId,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
    },
  };
}

export interface FakeCoreCall {
  method: "register" | "report" | "end" | "list";
  input: unknown;
}

export interface FakeCoreClient extends CoreClient {
  readonly calls: FakeCoreCall[];
  readonly sessions: Map<string, RegisteredAgentSession & { latest?: RuntimeReport }>;
  failNextReports: number;
}

export function createFakeCoreClient(now: () => string = () => new Date(0).toISOString()): FakeCoreClient {
  const calls: FakeCoreCall[] = [];
  const sessions = new Map<string, RegisteredAgentSession & { latest?: RuntimeReport }>();
  const client: FakeCoreClient = {
    calls,
    sessions,
    failNextReports: 0,
    async registerAgentSession(_agentCtx, input: RegisterAgentSessionInput) {
      calls.push({ method: "register", input: { ...input } });
      if (input.taskId.trim().length === 0) {
        throw new ValidationError("taskId is required", { field: "taskId" });
      }
      const session: RegisteredAgentSession = {
        id: `ses_${randomBytes(8).toString("hex")}`,
        agentId: input.agentId,
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        harness: input.harness,
        startedAt: now(),
      };
      sessions.set(session.id, session);
      return session;
    },
    async reportAgentSessionRuntime(_agentCtx, input: RuntimeReportInput) {
      if (client.failNextReports > 0) {
        client.failNextReports -= 1;
        calls.push({ method: "report", input: { rejected: true, sequence: input.sequence, state: input.state } });
        throw new Error("network down");
      }
      calls.push({ method: "report", input: { ...input } });
      const session = sessions.get(input.sessionId);
      if (session === undefined) {
        throw new ValidationError("Session not found", { field: "sessionId" });
      }
      const final = input.state === "exited" || input.state === "failed";
      const report: RuntimeReport = {
        sessionId: input.sessionId,
        state: input.state,
        sequence: input.sequence,
        reportedAt: now(),
        ...(final ? {} : { expiresAt: now() }),
        ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
        ...(input.failureKind === undefined ? {} : { failureKind: input.failureKind }),
      };
      session.latest = report;
      return report;
    },
    async endAgentSession(_agentCtx, sessionId: string) {
      calls.push({ method: "end", input: { sessionId } });
      const session = sessions.get(sessionId);
      if (session !== undefined) session.endedAt = now();
    },
    async listAgentSessions(_readerCtx, input: AgentSessionListInput): Promise<AgentSessionListPage> {
      calls.push({ method: "list", input: { ...input } });
      const sessionsOut: ListedAgentSession[] = [];
      for (const session of sessions.values()) {
        if (session.workspaceId !== input.workspaceId) continue;
        sessionsOut.push({
          id: session.id,
          workspaceId: session.workspaceId,
          ...(session.taskId === undefined ? {} : { taskId: session.taskId }),
          agentId: session.agentId,
          harness: session.harness,
          ...(session.humanId === undefined ? {} : { humanId: session.humanId }),
          startedAt: session.startedAt,
          ...(session.endedAt === undefined ? {} : { endedAt: session.endedAt }),
          ...(session.latest === undefined
            ? {}
            : {
                state: session.latest.state,
                reportedAt: session.latest.reportedAt,
                ...(session.latest.expiresAt === undefined ? {} : { expiresAt: session.latest.expiresAt }),
                ...(session.latest.exitCode === undefined ? {} : { exitCode: session.latest.exitCode }),
              }),
        });
      }
      return { sessions: sessionsOut, serverTime: now() };
    },
  };
  return client;
}
