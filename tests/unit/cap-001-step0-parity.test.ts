/**
 * CAP-001 Step 0 contract parity.
 *
 * The exported test fixtures under fixtures/cap-001/contract/ must stay
 * byte-identical to the private frozen Step 0 evidence. This test is kept out
 * of the public snapshot because docs/evidence/ is not exported.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STEP0 = join(ROOT, "docs/evidence/cap-001/step-0");
const CONTRACT = join(ROOT, "fixtures/cap-001/contract");

const FILES = [
  ["proposed/catalog.json", "catalog.json"],
  ["proposed/queries.json", "queries.json"],
  ["proposed/aliases.json", "aliases.json"],
  ["proposed/continue-blocked-work.json", "continue-blocked-work.json"],
  ["proposed/review-decision-basis.json", "review-decision-basis.json"],
  ["proposed/search-schema.md", "search-schema.md"],
  ["answer-key.json", "answer-key.json"],
] as const;

describe("CAP-001 Step 0 contract copies", () => {
  it.each(FILES)("%s matches the exported contract copy", (evidencePath, contractPath) => {
    const evidence = readFileSync(join(STEP0, evidencePath));
    const contract = readFileSync(join(CONTRACT, contractPath));
    expect(contract.equals(evidence)).toBe(true);
  });
});
