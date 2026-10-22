/**
 * The public export excludes docs/evidence, so the frozen ACT-001 Step 0
 * fixtures needed by the exported tests are copied under
 * fixtures/act-001/step-0/. This private-only test keeps every copy
 * byte-equal to the canonical evidence; the exporter excludes this file.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PRIVATE = new URL("../../docs/evidence/act-001/step-0/", import.meta.url);
const PUBLIC = new URL("../../fixtures/act-001/step-0/", import.meta.url);

const FILES = [
  "answer-key.json",
  "baseline/cli-command-names-playbook-off.txt",
  "baseline/event-vocabulary.json",
  "baseline/http-methods.json",
  "baseline/mcp-tool-names-playbook-off.txt",
  "baseline/orientation-projection.json",
  "baseline/viewer-allowlist.json",
  "proposal/digest-vectors.json",
  "proposal/signed-payloads.json",
];

describe("ACT-001 Step 0 fixture parity", () => {
  for (const file of FILES) {
    it(`${file} matches the private Step 0 evidence`, () => {
      expect(readFileSync(new URL(file, PUBLIC))).toEqual(readFileSync(new URL(file, PRIVATE)));
    });
  }
});
