/**
 * Installed package version.
 *
 * Source checkouts keep package.json at the repo root. The release layout
 * keeps it at lib/campfire/package.json, two directories above dist/src.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function installedCampfireVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const relative of ["../../package.json", "../../../package.json"]) {
    try {
      const parsed = JSON.parse(readFileSync(join(here, relative), "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
    } catch {
      // Try the other installed layout.
    }
  }
  throw new Error("Could not read the installed Campfire version");
}
