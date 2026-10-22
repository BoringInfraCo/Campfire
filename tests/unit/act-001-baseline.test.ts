/**
 * ACT-001 D1 baseline preservation + D8 fresh-vs-upgraded equivalence.
 *
 * v1.25.0 is the frozen baseline (docs/evidence/act-001/step-0/baseline/* and
 * answer-key.json). ACT-001 adds exactly: 8 service methods, 6 MCP tools, the
 * `actions` CLI family, and POST /v1/integrations/github/:sourceId. The Viewer
 * allowlist (12 reads), outbound event vocabulary (8), and CAP-001 recipes
 * must be unchanged. No product semantics change here.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CAMPFIRE_HTTP_METHODS } from "../../src/http/dispatch.js";
import {
  MCP_TOOL_NAMES,
  assertCorpusParity,
  getReadRecipe,
} from "../../src/catalog/capability-search.js";
import { CLI_COMMAND_NAMES, commandSpec, discoverableCommandNames } from "../../src/cli/catalog.js";
import { VIEWER_READ_METHODS } from "../../src/viewer/server.js";
import { CAMPFIRE_EVENT_TYPES } from "../../src/domain/events.js";
import { githubIngressPathSourceId } from "../../src/service/github-ingress.js";
import { ValidationError } from "../../src/domain/errors.js";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import { schemaVersion } from "../../src/store/migrations.js";
import { createCampfireService } from "../../src/service/campfire-service.js";
import { ACT001, seedAct001Database } from "../../fixtures/act-001/seed.js";

// Public copies of the frozen Step 0 baseline, kept byte-equal to
// docs/evidence/act-001/step-0/ by act-001-step0-parity.test.ts. The public
// export excludes docs/evidence, so the exported tests read these copies.
const BASELINE = new URL("../../fixtures/act-001/step-0/baseline/", import.meta.url);
const ANSWER_KEY = JSON.parse(
  readFileSync(new URL("../../fixtures/act-001/step-0/answer-key.json", import.meta.url), "utf8"),
) as {
  baseline: {
    package: string;
    cliCommandsOff: number;
    mcpToolsOff: number;
    httpMethods: number;
    viewerReads: number;
    orientationTopKeys: number;
    outboundEvents: number;
  };
  interfaces: { serviceMethods: number; mcpTools: number; cliFamily: string; ingress: string };
  contributionCounts: { ws_act001_lab: number; ws_act001_other: number };
};

function baselineJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, BASELINE), "utf8")) as T;
}

function baselineLines(name: string): string[] {
  return readFileSync(new URL(name, BASELINE), "utf8").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

const EXPECTED_HTTP_ADDITIONS = [
  "propose_action",
  "review_action",
  "cancel_action",
  "reserve_action_execution",
  "record_action_outcome",
  "get_action_proposal",
  "list_action_proposals",
  "list_action_receipts",
] as const;

const EXPECTED_MCP_ADDITIONS = [
  "propose_action",
  "reserve_action_execution",
  "record_action_outcome",
  "get_action_proposal",
  "list_action_proposals",
  "list_action_receipts",
] as const;

describe("ACT-001 D1 baseline preservation", () => {
  it("pins v1.25 HTTP methods (47) plus exactly the 8 ACT-001 service methods", () => {
    const frozen = baselineJson<{ count: number; methods: string[] }>("http-methods.json");
    expect(frozen.count).toBe(47);
    expect(frozen.methods).toHaveLength(47);
    expect(ANSWER_KEY.baseline.httpMethods).toBe(47);
    expect(ANSWER_KEY.interfaces.serviceMethods).toBe(8);
    expect(CAMPFIRE_HTTP_METHODS).toHaveLength(frozen.count + EXPECTED_HTTP_ADDITIONS.length);
    expect(new Set(CAMPFIRE_HTTP_METHODS).size).toBe(CAMPFIRE_HTTP_METHODS.length);
    const added = CAMPFIRE_HTTP_METHODS.filter((method) => !frozen.methods.includes(method));
    expect([...added].sort()).toEqual([...EXPECTED_HTTP_ADDITIONS].sort());
  });

  it("pins v1.25 MCP tools (40) plus exactly the 6 ACT-001 agent tools", () => {
    const frozen = baselineLines("mcp-tool-names-playbook-off.txt");
    expect(frozen).toHaveLength(40);
    expect(ANSWER_KEY.baseline.mcpToolsOff).toBe(40);
    expect(ANSWER_KEY.interfaces.mcpTools).toBe(6);
    expect(MCP_TOOL_NAMES).toHaveLength(frozen.length + EXPECTED_MCP_ADDITIONS.length);
    expect(new Set(MCP_TOOL_NAMES).size).toBe(MCP_TOOL_NAMES.length);
    const added = MCP_TOOL_NAMES.filter((tool) => !frozen.includes(tool));
    expect([...added].sort()).toEqual([...EXPECTED_MCP_ADDITIONS].sort());
    // Human-only review/cancel never become agent MCP tools.
    expect(MCP_TOOL_NAMES).not.toContain("review_action");
    expect(MCP_TOOL_NAMES).not.toContain("cancel_action");
  });

  it("pins v1.25 CLI commands (59) plus exactly the actions family", () => {
    const frozen = baselineLines("cli-command-names-playbook-off.txt");
    expect(frozen).toHaveLength(59);
    expect(ANSWER_KEY.baseline.cliCommandsOff).toBe(59);
    expect(ANSWER_KEY.interfaces.cliFamily).toBe("campfire actions");
    // Playbook is the only gated command; every other name is default-visible.
    const visible = CLI_COMMAND_NAMES.filter((name) => name !== "playbook");
    expect(visible).toHaveLength(frozen.length + 1);
    const added = visible.filter((name) => !frozen.includes(name));
    expect(added).toEqual(["actions"]);
    const spec = commandSpec("actions");
    expect(spec.usage).toBe(
      "campfire actions propose|approve|reject|cancel|reserve|receipt|inspect|list|receipts [--output auto|human|json]",
    );
    expect(spec.variants?.map((variant) => variant.selector).sort()).toEqual(
      ["approve", "cancel", "inspect", "list", "propose", "receipt", "receipts", "reject", "reserve"].sort(),
    );
  });

  it("keeps the Viewer allowlist at exactly the 12 v1.25 reads", () => {
    const frozen = baselineJson<{ count: number; methods: string[] }>("viewer-allowlist.json");
    expect(frozen.count).toBe(12);
    expect(ANSWER_KEY.baseline.viewerReads).toBe(12);
    expect([...VIEWER_READ_METHODS].sort()).toEqual([...frozen.methods].sort());
    for (const method of EXPECTED_HTTP_ADDITIONS) {
      expect(VIEWER_READ_METHODS as readonly string[]).not.toContain(method);
    }
  });

  it("keeps the outbound event vocabulary at exactly the 8 v1.25 events", () => {
    const frozen = baselineJson<{
      outboundEventVocabulary: string[];
      outboundEventCount: number;
      contributionObjectTypes: string[];
    }>("event-vocabulary.json");
    expect(frozen.outboundEventCount).toBe(8);
    expect(ANSWER_KEY.baseline.outboundEvents).toBe(8);
    expect([...CAMPFIRE_EVENT_TYPES].sort()).toEqual([...frozen.outboundEventVocabulary].sort());
    // ACT-001 records Contributions under two explicit new object types and
    // adds no outbound DomainEvent. The baseline file pins the other 10.
    const source = readFileSync(new URL("../../src/domain/types.ts", import.meta.url), "utf8");
    const start = source.indexOf("export type ContributionObjectType =");
    const block = source.slice(start, source.indexOf(";", start));
    const members = [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
    expect(members.filter((member) => member !== "action_proposal" && member !== "action_receipt").sort()).toEqual(
      [...frozen.contributionObjectTypes].sort(),
    );
    expect(members).toContain("action_proposal");
    expect(members).toContain("action_receipt");
    expect(members).toHaveLength(frozen.contributionObjectTypes.length + 2);
  });

  it("leaves the CAP-001 read recipes unchanged and the catalog in parity", () => {
    expect(getReadRecipe("continue-blocked-work").recipeVersion).toBe(1);
    expect(getReadRecipe("review-decision-basis").recipeVersion).toBe(1);
    expect(() => getReadRecipe("retry-verification")).toThrow(ValidationError);
    // Every installed command and tool is either in the search corpus or an
    // explicitly omitted entry; the actions family maps to `campfire actions`.
    // Playbook-gated and default surfaces are checked separately, mirroring
    // the CAP-001 parity test.
    const discoverableOff = discoverableCommandNames({});
    const discoverableOn = discoverableCommandNames({ CAMPFIRE_PLAYBOOK: "1" });
    expect(discoverableOff).not.toContain("playbook");
    expect(discoverableOn).toContain("playbook");
    expect(() =>
      assertCorpusParity({ cliCommands: [...discoverableOff], mcpTools: [...MCP_TOOL_NAMES], playbookEnabled: false }),
    ).not.toThrow();
    expect(() =>
      assertCorpusParity({
        cliCommands: [...discoverableOn],
        mcpTools: [...MCP_TOOL_NAMES, "get_playbook"],
        playbookEnabled: true,
      }),
    ).not.toThrow();
  });

  it("keeps the single operator-bound ingress route and no MCP equivalent", () => {
    expect(ANSWER_KEY.interfaces.ingress).toBe("POST /v1/integrations/github/:sourceId");
    expect(githubIngressPathSourceId("/v1/integrations/github/src_act001_github")).toBe("src_act001_github");
    expect(githubIngressPathSourceId("/v1/integrations/github/")).toBeUndefined();
    expect(githubIngressPathSourceId("/v1/call")).toBeUndefined();
  });

  it("keeps the frozen baseline package and ships the release target", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    // The Step 0 answer key stays pinned to the released v1.25.0 baseline;
    // release preparation moves the package to the separately decided target.
    expect(ANSWER_KEY.baseline.package).toBe("1.25.0");
    expect(pkg.version).toBe("1.26.1");
    const orientation = baselineJson<{ topKeys: string[] }>("orientation-projection.json");
    expect(orientation.topKeys).toHaveLength(26);
    expect(ANSWER_KEY.baseline.orientationTopKeys).toBe(26);
  });

  it("a live orientation projection still has exactly the 26 frozen top-level keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "act001-baseline-orient-"));
    try {
      const seeded = seedAct001Database(join(dir, "campfire.db"));
      const store = openSqliteStore(join(dir, "campfire.db"));
      try {
        const service = createCampfireService({ store, clock: () => "2026-10-21T12:10:00.000Z" });
        try {
          const context = service.getWorkspaceContext(
            { actor: { actorId: ACT001.humans.owner, actorType: "human" } },
            seeded.workspaceId,
          );
          const frozen = baselineJson<{ topKeys: string[] }>("orientation-projection.json");
          expect(Object.keys(context).sort()).toEqual([...frozen.topKeys].sort());
        } finally {
          service.close();
        }
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ACT-001 D8 fresh-vs-upgraded equivalence", () => {
  it("upgrades a v1.25-era database through 0009 to the same answer keys as a fresh database", () => {
    const freshDir = mkdtempSync(join(tmpdir(), "act001-baseline-fresh-"));
    const upgradeDir = mkdtempSync(join(tmpdir(), "act001-baseline-upgrade-"));
    try {
      const fresh = seedAct001Database(join(freshDir, "campfire.db"));

      // Simulate a v1.25-era database: migrate fresh, then remove everything
      // migration 0009 (v10) created and mark the schema back at v9.
      const upgradePath = join(upgradeDir, "campfire.db");
      const initial = openSqliteStore(upgradePath);
      initial.close();
      const legacy = new Database(upgradePath);
      legacy.exec(`
        DROP TABLE IF EXISTS github_ingress_receipts;
        DROP TABLE IF EXISTS github_ingress_deliveries;
        DROP TABLE IF EXISTS github_source_bindings;
        DROP TABLE IF EXISTS action_mutation_receipts;
        DROP TABLE IF EXISTS action_receipts;
        DROP TABLE IF EXISTS action_target_reservations;
        DROP TABLE IF EXISTS action_proposals;
        DELETE FROM schema_migrations WHERE version >= 10;
      `);
      const downgraded = legacy.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
        version: number;
      };
      expect(downgraded.version).toBe(9);
      legacy.close();

      const upgraded = seedAct001Database(upgradePath);

      // The reopen applies 0009 and reaches the current schema version.
      const check = new Database(upgradePath);
      try {
        const version = check.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
          version: number;
        };
        expect(version.version).toBe(schemaVersion(check));
        expect(version.version).toBe(10);
        const tables = check
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'action%' OR name LIKE 'github_ingress%' OR name LIKE 'github_source%')")
          .all() as Array<{ name: string }>;
        expect(tables.map((row) => row.name).sort()).toEqual(
          [
            "action_mutation_receipts",
            "action_proposals",
            "action_receipts",
            "action_target_reservations",
            "github_ingress_deliveries",
            "github_ingress_receipts",
            "github_source_bindings",
          ].sort(),
        );
      } finally {
        check.close();
      }

      // Same answer keys on both paths: frozen ids, seed clock, and
      // contribution counts. (The Step-0 answer-key file pins 14/1 from
      // before reads recorded contributions; the live seed now records
      // reads too, so the equivalence that matters is fresh == upgraded.)
      const strip = (result: typeof fresh) => ({ ...result, tokens: undefined });
      expect(strip(upgraded)).toEqual(strip(fresh));
      expect(upgraded.workspaceId).toBe(ACT001.workspace);
      expect(upgraded.otherWorkspaceId).toBe(ACT001.otherWorkspace);
      expect(upgraded.taskId).toBe(ACT001.task);
      expect(upgraded.findings).toEqual({ ...ACT001.findings });
      expect(upgraded.contributionCounts.lab).toBeGreaterThan(0);
      expect(upgraded.contributionCounts).toEqual(fresh.contributionCounts);
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
      rmSync(upgradeDir, { recursive: true, force: true });
    }
  });
});
