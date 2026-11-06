import { ValidationError } from "../domain/errors.js";
import { SESSION_HOST_DISABLED_MESSAGE } from "./types.js";

/** Exact `1` only. Other truthy strings stay off so the gate cannot be implied. */
export function sessionHostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CAMPFIRE_SESSION_HOST === "1";
}

export function assertSessionHostEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (!sessionHostEnabled(env)) {
    throw new ValidationError(SESSION_HOST_DISABLED_MESSAGE, {
      field: "CAMPFIRE_SESSION_HOST",
      nextAction: "set_session_host_flag",
    });
  }
}
