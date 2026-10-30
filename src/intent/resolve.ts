/**
 * One operator call closure for the intent bridge, with the same config and
 * credential resolution `campfire up` uses (src/cli/index.ts cmdUp), factored
 * so the desktop channel is process-closure-bound exactly like the Viewer
 * read channel without duplicating profile logic.
 *
 * Local profile: the acting identity is the operator human resolved from the
 * stored credential inside this process; no token is ever held by or handed
 * to the HTTP caller (the closure calls the service directly).
 *
 * Hosted profile: `campfireHttpCall` relays with the operator's own stored
 * HUMAN credential; the bridge still binds loopback so the desktop app
 * remains token-free — the credential lives only in this process, like the
 * remote `campfire up` Viewer.
 *
 * This module never inspects the database itself beyond the service/store
 * facade runtime resolution that `campfire up` already performs, and it
 * writes nothing: it only builds the pre-authorized closure.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../config.js";
import { createRuntime, type CampfireRuntime } from "../runtime.js";
import { loadAnyProfile, readOperatorHumanToken } from "../bootstrap/profile.js";
import { resolveRemoteAccess } from "../bootstrap/remote-profile.js";
import { campfireHttpCall } from "../http/client.js";
import { dispatchCampfireMethod } from "../http/dispatch.js";
import { assertLocalWritesAllowed, isPublicationBlockedMethod } from "../publication/state.js";
import { ValidationError } from "../domain/errors.js";
import type { ActorRef } from "../domain/types.js";

export interface OperatorCall {
  mode: "local" | "remote";
  /** Displayed endpoint this operator's authority is bound to. */
  url: string;
  /** The resolved operator human identity, for receipts and access logs. */
  actor: ActorRef;
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  /** Close after the bridge stops. Remote profiles close nothing. */
  close(): Promise<void>;
}

function ensureParentDir(databasePath: string): void {
  mkdirSync(dirname(databasePath), { recursive: true });
}

export async function resolveOperatorCall(
  input: { url?: string; token?: string } = {},
): Promise<OperatorCall> {
  const profile = loadAnyProfile();
  if (profile === undefined) {
    throw new ValidationError("No Campfire profile yet. Run campfire onboard.", { field: "intent" });
  }

  if (profile.mode === "remote") {
    const access = resolveRemoteAccess({ url: input.url, token: input.token });
    const call = (method: string, params: Record<string, unknown>) =>
      campfireHttpCall({ baseUrl: access.url, token: access.token, method, params });
    // Same eligibility rule as the remote `up` Viewer: the desktop channel
    // acts as the operator human, never through an agent credential.
    const who = (await call("whoami", {})) as { actor?: ActorRef };
    const whoActor = who.actor;
    if (
      whoActor === undefined ||
      whoActor.actorType !== "human" ||
      (access.url === profile.url && whoActor.actorId !== profile.humanId)
    ) {
      throw new ValidationError("Intent bridge requires the operator's human credential", {
        field: "credentials",
        nextAction: "use_recipient_human_credential",
      });
    }
    return {
      mode: "remote",
      url: access.url,
      actor: { actorId: whoActor.actorId, actorType: "human" },
      call,
      async close(): Promise<void> {},
    };
  }

  const humanToken = readOperatorHumanToken();
  if (humanToken === undefined) {
    throw new ValidationError("Missing operator credential. Re-run campfire onboard.", { field: "credentials" });
  }
  const config = loadConfig();
  ensureParentDir(config.databasePath);
  const runtime: CampfireRuntime = createRuntime(config);
  try {
    const actor = runtime.service.resolveToken(humanToken);
    const human = runtime.store.getHuman(actor.actorId);
    if (human === undefined) {
      throw new ValidationError("The stored operator credential is not a human.", { field: "credentials" });
    }
    const ctx = { actor };
    // Preserve the same upstream write gates as every supported local write
    // surface: publication-blocked methods fail closed while a publication
    // freeze or cutover is active (src/publication/state.ts).
    return {
      mode: "local",
      // The local profile's configured endpoint is a display fact, not a
      // dependency: the closure writes through the in-process service.
      url: profile.url,
      actor: { actorId: actor.actorId, actorType: "human" },
      call: (method, params) => {
        if (isPublicationBlockedMethod(method)) assertLocalWritesAllowed(config.databasePath);
        return Promise.resolve(dispatchCampfireMethod(runtime.service, ctx, method, params ?? {}));
      },
      async close(): Promise<void> {
        runtime.close();
      },
    };
  } catch (error) {
    runtime.close();
    throw error;
  }
}
