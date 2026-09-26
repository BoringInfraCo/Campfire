import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "campfire-test-xdg-"));
  process.env.CAMPFIRE_CONFIG_DIR = join(root, "config");
  process.env.CAMPFIRE_DATA_DIR = join(root, "data");
});
