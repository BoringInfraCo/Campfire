import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "campfire-test-xdg-"));
  process.env.CAMPFIRE_CONFIG_DIR = join(root, "config");
  process.env.CAMPFIRE_DATA_DIR = join(root, "data");
  // Harness config paths derive from HOME / XDG_CONFIG_HOME. Isolate them so an
  // operator's real Codex or OpenCode connection (including a live Campfire
  // block) can never change a test outcome. CAMPFIRE_CONFIG_DIR alone does not
  // cover defaultHarnessConfigPath.
  process.env.HOME = join(root, "home");
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
});
