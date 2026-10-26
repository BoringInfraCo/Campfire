/**
 * In-process record of a Campfire API or Viewer this process started.
 * A second process must not treat a pid in another terminal as owned.
 */
export interface OwnedCampfireService {
  profileMode: "local" | "remote";
  /** Startup argv after the node binary, for example `["up"]`. */
  argv: readonly string[];
  apiUrl?: string;
  viewerUrl?: string;
  stop: () => Promise<void>;
}

let owner: OwnedCampfireService | undefined;

export function setOwnedCampfireService(service: OwnedCampfireService | undefined): void {
  owner = service;
}

export function ownedCampfireService(): OwnedCampfireService | undefined {
  return owner;
}
