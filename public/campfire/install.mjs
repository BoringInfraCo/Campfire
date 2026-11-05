#!/usr/bin/env bun
// Install Campfire with Bun. Bun only runs this installer. The campfire
// command still executes on Node.js 22, from the same checksummed GitHub
// Release archive as the curl installer. This never installs Node.js.
//
//   bun https://raw.githubusercontent.com/BoringInfraCo/Campfire/main/public/campfire/install.mjs
//
// Flags match public/campfire/install.sh (--version, --prefix, --dry-run).

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptUrl = new URL("./install.sh", import.meta.url);
let script;
if (scriptUrl.protocol === "file:") {
  script = readFileSync(fileURLToPath(scriptUrl), "utf8");
} else {
  const response = await fetch(scriptUrl);
  if (!response.ok) {
    console.error(`campfire: could not download install.sh (${response.status})`);
    process.exit(1);
  }
  script = await response.text();
}

const directory = mkdtempSync(join(tmpdir(), "campfire-bun-install-"));
const scriptPath = join(directory, "install.sh");
try {
  writeFileSync(scriptPath, script, { mode: 0o755 });
  chmodSync(scriptPath, 0o755);
  const child = spawnSync("sh", [scriptPath, ...process.argv.slice(2)], { stdio: "inherit" });
  if (child.error) {
    console.error(`campfire: could not run install.sh (${child.error.message})`);
    process.exit(1);
  }
  process.exit(child.status ?? 1);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
