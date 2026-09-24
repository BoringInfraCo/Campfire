/**
 * Runtime composition root.
 *
 * Wires a SQLite store to the Campfire application service. This is the only
 * place an interface (MCP, CLI, future HTTP/UI) should obtain a concrete
 * service. Interfaces depend on the `CampfireService` contract, never on
 * storage details (AGENTS.md invariant 7).
 */
import { loadConfig } from "./config.js";
import type { CampfireConfig } from "./config.js";
import { createCampfireService } from "./service/campfire-service.js";
import type { CampfireService } from "./service/service.js";
import { openSqliteStore } from "./store/sqlite-store.js";
import type { CampfireStore } from "./store/store.js";

export interface CampfireRuntime {
  config: CampfireConfig;
  store: CampfireStore;
  service: CampfireService;
  close(): void;
}

export function createRuntime(config: CampfireConfig = loadConfig()): CampfireRuntime {
  const store = openSqliteStore(config.databasePath);
  const service = createCampfireService({ store });
  return {
    config,
    store,
    service,
    close(): void {
      // The service owns the store lifecycle; closing it closes SQLite.
      service.close();
    },
  };
}

export function createRuntimeFromPath(databasePath: string): CampfireRuntime {
  return createRuntime({ ...loadConfig(), databasePath });
}
