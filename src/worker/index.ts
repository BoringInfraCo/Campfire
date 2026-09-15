/**
 * Cloudflare Workers entrypoint for Campfire.
 *
 * Production wiring: D1 (`env.DB`) -> async store -> async application
 * service -> thin fetch handler, with viewer static served via Workers
 * Assets (`env.ASSETS`). No secrets in code; actor identity always comes
 * from the bearer token (service.resolveToken), never from request params.
 */
import { createD1Store } from "./d1-store.js";
import type { CampfireWorkerEnv } from "./d1-types.js";
import { createD1WorkerHandler } from "./handler.js";

export default {
  async fetch(request: Request, env: CampfireWorkerEnv): Promise<Response> {
    const store = createD1Store(env.DB);
    const handle = createD1WorkerHandler({
      store,
      assetsFetch: (req) => env.ASSETS.fetch(req),
    });
    return handle(request);
  },
};
