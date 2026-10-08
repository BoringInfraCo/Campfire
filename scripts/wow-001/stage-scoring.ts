/** Blind, isolated score packets. Keep the arm mapping outside scorer mounts. */
import { randomInt } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, resolvePilotRoot } from "./pilot-lib.js";

const runs = [
  "s1-control-pilot1", "s1-treatment-pilot1",
  "s2-treatment-pilot1", "s2-control-pilot1",
  "s3-control-pilot1", "s3-treatment-pilot1",
];
const root = join(resolvePilotRoot(), "scoring");
if (existsSync(root)) throw new Error(`Scoring root already exists: ${root}`);
const contract = readFileSync(join(REPO_ROOT, "docs", "Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md"), "utf8");
const section = contract.split("### 4.5 Rubric and pilot pass criteria\n")[1]?.split("\n## 5. Architecture and compatibility")[0];
if (section === undefined) throw new Error("Could not isolate the frozen rubric");

const shuffled = [...runs];
for (let i = shuffled.length - 1; i > 0; i -= 1) {
  const j = randomInt(i + 1);
  [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
}

mkdirSync(root, { recursive: true, mode: 0o700 });
chmodSync(root, 0o700);
const mapping: Record<string, string> = {};
for (let i = 0; i < shuffled.length; i += 1) {
  const runId = shuffled[i]!;
  const label = `P${i + 1}`;
  mapping[label] = runId;
  const scenario = runId.slice(0, 2).toUpperCase();
  const receipt = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "evidence", "wow-001", "runs", runId, "receipt.json"), "utf8")) as {
    firstAgentId: string;
    setupStreamTip: number;
    seeded: { priorAgentId?: string } | null;
  };
  const packet = join(root, label, "packet");
  mkdirSync(packet, { recursive: true });
  const evidence = join(REPO_ROOT, "docs", "evidence", "wow-001", "runs", runId);
  copyFileSync(join(evidence, "workspace.json"), join(packet, "workspace.json"));
  copyFileSync(join(evidence, "second-answer.md"), join(packet, "second-answer.md"));
  copyFileSync(join(REPO_ROOT, "scripts", "wow-001", "scorer-instructions.md"), join(packet, "scorer-instructions.md"));
  copyFileSync(join(REPO_ROOT, "fixtures", "incidents", "wow-001", scenario, "scoring-key.md"), join(packet, "scoring-key.md"));
  writeFileSync(join(packet, "rubric.md"), `### 4.5 Rubric and pilot pass criteria\n${section}\n`);
  writeFileSync(join(packet, "setup.json"), `${JSON.stringify({
    scenario,
    firstAgentId: receipt.firstAgentId,
    seededPriorAgentId: receipt.seeded?.priorAgentId ?? null,
    setupStreamTip: receipt.setupStreamTip,
  }, null, 2)}\n`);
  for (const scorer of ["A", "B"]) {
    const scorerRoot = join(root, label, scorer);
    const configDir = join(scorerRoot, "config");
    const dataDir = join(scorerRoot, "data");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(configDir, ".gitignore"), "node_modules\npackage.json\npackage-lock.json\n");
    writeFileSync(join(configDir, "opencode.json"), `${JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      share: "disabled", autoupdate: false, snapshot: false, formatter: false, lsp: false,
      permission: {
        bash: "deny", edit: "deny", webfetch: "deny", websearch: "deny",
        external_directory: { "*": "deny", "/run/**": "allow" },
      },
    }, null, 2)}\n`);
    // Packets are staged without credentials. An authorized scoring launch
    // must supply its own short-lived authentication source.
  }
  console.log(`${label}: ${scenario}`);
}
const mappingPath = join(root, "mapping.json");
writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, { mode: 0o600 });
chmodSync(mappingPath, 0o600);
