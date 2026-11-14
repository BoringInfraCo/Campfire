/**
 * Loopback or hosted `POST /v1/call`. Matches src/http/client.ts:
 * bearer token, JSON `{ method, params }`, 15s timeout, redirect: error.
 * Success is `{ ok: true, result }`. Failure is `{ ok: false, error, message }`.
 * The sidecar calls the workspace reads listed in `SliceMethod`.
 */

const CALL_TIMEOUT_MS = 15_000;

export interface CallSuccess<T> {
  ok: true;
  result: T;
}

export interface CallFailure {
  ok: false;
  error: string;
  message: string;
  recoveryCode?: string;
}

export type CallResponse<T> = CallSuccess<T> | CallFailure;

export type SliceMethod =
  | "get_workspace_context" | "list_workspaces" | "get_workspace_attention"
  | "list_tasks" | "list_workspace_participants" | "get_activity"
  | "get_task" | "get_decision" | "get_finding" | "get_artifact" | "get_action_proposal" | "get_record_history";

export function callUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/call`;
}

function failure(error: string, message: string): CallFailure {
  return { ok: false, error, message };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

/** Parse a Campfire HTTP body. Network and redirect failures throw. */
export async function postCall<T>(
  baseUrl: string,
  token: string,
  method: SliceMethod,
  params: Record<string, unknown>,
): Promise<CallResponse<T>> {
  let response: Response;
  try {
    response = await fetch(callUrl(baseUrl), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ method, params }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Campfire request failed";
    if (token.length > 0 && message.includes(token)) {
      throw new Error("Campfire request failed");
    }
    throw error instanceof Error ? error : new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (response.status === 401 || response.status === 403) return failure("Unauthorized", "Authorization refused.");
    return failure("ValidationError", `Campfire HTTP ${response.status}: response was not JSON`);
  }
  if (response.status === 401 || response.status === 403) return failure("Unauthorized", "Authorization refused.");
  const body = asRecord(payload);
  if (body === undefined) {
    return failure("ValidationError", "Campfire HTTP response was not an object");
  }
  if (body.ok === true) {
    if (!response.ok) return failure("ValidationError", `Campfire HTTP ${response.status}: request failed`);
    return { ok: true, result: body.result as T };
  }
  if (body.ok === false) {
    const error = typeof body.error === "string" && body.error.length > 0 ? body.error : "ValidationError";
    const rawMessage = typeof body.message === "string" && body.message.length > 0 ? body.message : "Campfire request failed";
    const message = token.length > 0 && rawMessage.includes(token) ? "Campfire request failed" : rawMessage;
    const details = asRecord(body.details);
    const recoveryCode = typeof details?.recoveryCode === "string" ? details.recoveryCode : undefined;
    return { ok: false, error, message, ...(recoveryCode === undefined ? {} : { recoveryCode }) };
  }
  return failure("ValidationError", "Campfire HTTP response was missing ok");
}
