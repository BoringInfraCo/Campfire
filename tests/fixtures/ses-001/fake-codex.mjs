#!/usr/bin/env node
/**
 * Deterministic Codex stand-in for SES-001. Not a real harness.
 * `--version` prints the sibling codex-version.txt. Otherwise it records
 * argv and a few environment keys in the working directory, then exits or waits.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

if (process.argv.includes("--version")) {
  const version = readFileSync(join(here, "codex-version.txt"), "utf8").trim();
  process.stdout.write(`codex-cli ${version}\n`);
  process.exit(0);
}

writeFileSync(
  join(process.cwd(), "ses001-capture.json"),
  JSON.stringify({
    argv: process.argv,
    env: {
      CAMPFIRE_SESSION_ID: process.env.CAMPFIRE_SESSION_ID ?? null,
      CAMPFIRE_TOKEN: process.env.CAMPFIRE_TOKEN ?? null,
      CAMPFIRE_BRIDGE_TOKEN: process.env.CAMPFIRE_BRIDGE_TOKEN ?? null,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? null,
    },
  }),
);

const exitFile = join(process.cwd(), "ses001-exit-code");
if (existsSync(exitFile)) {
  const code = Number(readFileSync(exitFile, "utf8").trim());
  process.exit(Number.isInteger(code) ? code : 1);
}

setInterval(() => undefined, 60_000);
