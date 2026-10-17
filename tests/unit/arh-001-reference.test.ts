/**
 * ARH-001 D3/D5 checks for the frozen reference classification (scope §6).
 *
 * Unit evidence only. One file, three jobs:
 *  1. the terminal classifier satisfies the frozen taxonomy per class,
 *     including hostile markup, credentials, git: forms, and stale/none rows;
 *  2. D5 parity: `fixtures/artifact-handoff/arh-001/reference-samples.json` is
 *     the shared frozen sample set, and BOTH implementations —
 *     `src/presentation/work-console.ts` (terminal dashboard module) and the
 *     browser mirror in `src/viewer/static/app.js` — classify every row the
 *     same way and exactly as frozen; every frozen credential deny-set name
 *     carries an openable-shaped https sample row (value prefixed
 *     `arh001-demo-`) that classifies credential-bearing with no open control
 *     on either surface, so a one-name deny-set drift fails parity;
 *  3. D3 static audit: the Viewer's reference-rendering region fetches and
 *     navigates nothing on render, and the single anchor carries the opener,
 *     referrer, host-label, and openable-only guard; the Viewer shell copies
 *     under public/ stay byte-identical to src/viewer/static.
 *
 * Fixture evidence; cannot establish Gate B, C, or E.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_CREDENTIAL_QUERY_DENY_SET,
  ARTIFACT_EXTERNAL_UNVERIFIED_LABEL,
  ARTIFACT_OPEN_CONTROL_SUFFIX,
  ARTIFACT_UNSAFE_CONTROL_LABEL,
  artifactOpenControlLabel,
  classifyArtifactReference,
  viewerLabelDrift,
} from "../../src/presentation/work-console.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const APP_JS = readFileSync(join(ROOT, "src/viewer/static/app.js"), "utf8");
const PUBLIC_APP_JS = readFileSync(join(ROOT, "public/app.js"), "utf8");
const INDEX_HTML = readFileSync(join(ROOT, "src/viewer/static/index.html"), "utf8");

const SAMPLES = JSON.parse(
  readFileSync(join(ROOT, "fixtures/artifact-handoff/arh-001/reference-samples.json"), "utf8"),
) as {
  samples: Array<{
    reference: string;
    class: string;
    unsafe: boolean;
    openable: boolean;
    host: string | null;
  }>;
};

/** Same cut the UIX-001/SWH-001 harnesses use: everything except boot(). */
function loadAppSandbox() {
  let fetchCalls = 0;
  const sandbox: Record<string, unknown> = {
    document: {
      documentElement: { dataset: {} as Record<string, string> },
      getElementById: () => null,
      addEventListener: () => {},
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("no fetch in sandbox");
    },
    setInterval: () => 0,
    URL,
    CSS: { escape: (value: string) => value },
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const cut = APP_JS.lastIndexOf("async function boot()");
  vm.runInContext(cut === -1 ? APP_JS : APP_JS.slice(0, cut), sandbox, { filename: "app.js" });
  return { sandbox, fetchCalls: () => fetchCalls };
}

describe("ARH-001 frozen reference classification (terminal module)", () => {
  it("classifies every frozen sample row exactly as recorded", () => {
    expect(SAMPLES.samples.length).toBeGreaterThanOrEqual(40);
    for (const sample of SAMPLES.samples) {
      const expected = {
        class: sample.class,
        unsafe: sample.unsafe,
        openable: sample.openable,
        host: sample.host,
      };
      expect(classifyArtifactReference(sample.reference), sample.reference).toEqual(expected);
    }
  });

  it("is deterministic — the same input classifies the same way every call", () => {
    for (const sample of SAMPLES.samples) {
      const first = classifyArtifactReference(sample.reference);
      for (let run = 0; run < 3; run += 1) {
        expect(classifyArtifactReference(sample.reference), sample.reference).toEqual(first);
      }
    }
  });

  it("keeps hostile markup unparsed and never openable, without the unsafe sweep", () => {
    // The lab's hostile markup row carries quote/angle/space characters but no
    // control characters: it is inert because the strict https contract
    // refuses to parse it, not because of the control sweep.
    const hostile = classifyArtifactReference('https://example.com/arh-001/report"><img src=x onerror=alert(1)>');
    expect(hostile).toEqual({ class: "unparsed", unsafe: false, openable: false, host: null });
  });

  it("classifies credential-bearing references before any scheme class", () => {
    expect(classifyArtifactReference("https://u:p@host/x?ok=1")).toEqual({
      class: "credential-bearing",
      unsafe: false,
      openable: false,
      host: null,
    });
    expect(classifyArtifactReference("ftp://host/x?token=abc")).toEqual({
      class: "credential-bearing",
      unsafe: false,
      openable: false,
      host: null,
    });
    // A non-hierarchical scheme never turns an `@` into userinfo; a deny-set
    // query parameter does apply to any reference.
    expect(classifyArtifactReference("mailto:team@example.com")).toEqual({
      class: "other scheme",
      unsafe: false,
      openable: false,
      host: null,
    });
    expect(classifyArtifactReference("mailto:team@example.com?token=abc")).toEqual({
      class: "credential-bearing",
      unsafe: false,
      openable: false,
      host: null,
    });
  });

  it("shows the stored authority text as the destination host for openable rows", () => {
    expect(classifyArtifactReference("https://EXAMPLE.COM/Reports/Q3.html")).toEqual({
      class: "openable https",
      unsafe: false,
      openable: true,
      host: "EXAMPLE.COM",
    });
    expect(classifyArtifactReference("https://example.com:8443/monitor.html")).toEqual({
      class: "openable https",
      unsafe: false,
      openable: true,
      host: "example.com:8443",
    });
  });

  it("classifies a hostless https shape as unparsed, never openable", () => {
    for (const reference of ["https://", "https:///x", "https:/x", "https:"]) {
      expect(classifyArtifactReference(reference), reference).toEqual({
        class: "unparsed",
        unsafe: false,
        openable: false,
        host: null,
      });
    }
    // A userinfo-shaped authority is credential-bearing even without a host.
    expect(classifyArtifactReference("https://u@/x")).toEqual({
      class: "credential-bearing",
      unsafe: false,
      openable: false,
      host: null,
    });
  });

  it("keeps invalid or browser-normalized destinations inert", () => {
    for (const reference of ["https://example.com:99999/report", "https://127.1/report", "https://./report"]) {
      expect(classifyArtifactReference(reference), reference).toEqual({
        class: "unparsed",
        unsafe: false,
        openable: false,
        host: null,
      });
    }
  });

  it("keeps common provider-signed URLs inert as credential-bearing", () => {
    for (const name of [
      "X-Amz-Signature", "X-Goog-Signature", "X-Amz-Credential",
      "X-Goog-Credential", "X-Amz-Security-Token", "AWSAccessKeyId", "GoogleAccessId",
    ]) {
      const reference = `https://example.com/report?${name}=demo`;
      expect(classifyArtifactReference(reference), reference).toEqual({
        class: "credential-bearing",
        unsafe: false,
        openable: false,
        host: null,
      });
    }
  });

  it("forces a control-character or newline reference inert and labeled unsafe", () => {
    for (const codePoint of [0x00, 0x09, 0x0a, 0x0d, 0x1b, 0x7f, 0x80, 0x9f]) {
      const reference = `https://example.com/a${String.fromCharCode(codePoint)}b`;
      const classification = classifyArtifactReference(reference);
      expect(classification.unsafe, reference).toBe(true);
      expect(classification.openable, reference).toBe(false);
      expect(classification.class, reference).toBe("unparsed");
    }
    expect(ARTIFACT_UNSAFE_CONTROL_LABEL).toContain("unsafe");
    expect(ARTIFACT_UNSAFE_CONTROL_LABEL).toContain("rendered inert");
  });

  it("classifies internal record forms as other scheme", () => {
    for (const reference of ["git:a1b2c3d4e5f6", "git://vcs.example.com/team/repo.git", "git:HEAD~3"]) {
      expect(classifyArtifactReference(reference), reference).toEqual({
        class: "other scheme",
        unsafe: false,
        openable: false,
        host: null,
      });
    }
  });

  it("includes the original credential names and the dated provider-signed correction", () => {
    expect([...ARTIFACT_CREDENTIAL_QUERY_DENY_SET].sort()).toEqual(
      [
        "token",
        "access_token",
        "auth",
        "api_key",
        "apikey",
        "key",
        "password",
        "secret",
        "signature",
        "sig",
        "session",
        "sessionid",
        "x-amz-signature",
        "x-goog-signature",
        "x-amz-credential",
        "x-goog-credential",
        "x-amz-security-token",
        "awsaccesskeyid",
        "googleaccessid",
      ].sort(),
    );
  });

  it("builds the open-control label with the host and the boundary words", () => {
    expect(artifactOpenControlLabel("example.com")).toBe(`Open example.com ${ARTIFACT_OPEN_CONTROL_SUFFIX}`);
    expect(artifactOpenControlLabel("example.com")).toContain(ARTIFACT_OPEN_CONTROL_SUFFIX);
  });

  it("carries the caveat wording that names the external boundary", () => {
    expect(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL).toBe(
      "external and unverified by Campfire; workspace membership does not grant access",
    );
    expect(INDEX_HTML).not.toContain(ARTIFACT_OPEN_CONTROL_SUFFIX);
  });
});

describe("ARH-001 D5 parity — terminal module vs browser mirror", () => {
  it("matches the dated invalid-destination and signed-URL corrections", () => {
    const { sandbox } = loadAppSandbox();
    const cases = [
      "https://example.com:99999/report",
      "https://127.1/report",
      "https://./report",
      ...[
        "X-Amz-Signature", "X-Goog-Signature", "X-Amz-Credential",
        "X-Goog-Credential", "X-Amz-Security-Token", "AWSAccessKeyId", "GoogleAccessId",
      ].map((name) => `https://example.com/report?${name}=demo`),
    ];
    for (const reference of cases) {
      const browser = vm.runInContext(
        `JSON.stringify(classifyArtifactReference(${JSON.stringify(reference)}))`,
        sandbox,
        { filename: "app.js" },
      ) as string;
      const terminal = classifyArtifactReference(reference);
      expect(JSON.parse(browser), reference).toEqual(terminal);
      expect(terminal.openable, reference).toBe(false);
    }
  });

  it("classifies every frozen sample identically in both implementations", () => {
    const { sandbox } = loadAppSandbox();
    for (const sample of SAMPLES.samples) {
      const expected = {
        class: sample.class,
        unsafe: sample.unsafe,
        openable: sample.openable,
        host: sample.host,
      };
      const browser = vm.runInContext(
        `JSON.stringify(classifyArtifactReference(${JSON.stringify(sample.reference)}))`,
        sandbox,
        { filename: "app.js" },
      ) as string;
      const terminal = classifyArtifactReference(sample.reference);
      expect(JSON.parse(browser), `app.js mirror for ${sample.reference}`).toEqual(terminal);
      expect(terminal, `frozen expectation for ${sample.reference}`).toEqual(expected);
    }
  });

  it("carries a sampled credential-bearing row for every original frozen deny-set name", () => {
    const { sandbox } = loadAppSandbox();
    // The 59-row preregistered sample set stays unchanged. Dated correction
    // cases above cover the additional provider-signed query names.
    for (const name of [
      "token", "access_token", "auth", "api_key", "apikey", "key",
      "password", "secret", "signature", "sig", "session", "sessionid",
    ]) {
      // The deny-set matches query names case-insensitively and exactly, so
      // coverage means a frozen row carrying `?name=` or `&name=` in that
      // position; the sampled value text itself is inert (arh001-demo-…).
      const rows = SAMPLES.samples.filter((sample) =>
        new RegExp(`[?&]${name}=`, "i").test(sample.reference),
      );
      expect(rows.length, `frozen sample coverage for deny-set name ${name}`).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        // These rows are otherwise strict-contract https shapes, so their
        // class pins the frozen precedence: the credential query check fires
        // before `openable https` eligibility. openable=false with host=null
        // means neither surface renders the open control for the row — the
        // only class-gated label there is.
        const expected = {
          class: "credential-bearing",
          unsafe: false,
          openable: false,
          host: null,
        };
        const browser = JSON.parse(
          vm.runInContext(
            `JSON.stringify(classifyArtifactReference(${JSON.stringify(row.reference)}))`,
            sandbox,
          ) as string,
        ) as unknown;
        expect(browser, `app.js mirror for ${row.reference}`).toEqual(expected);
        expect(classifyArtifactReference(row.reference), `terminal module for ${row.reference}`).toEqual(expected);
      }
    }
  });

  it("keeps the open-control label builder mirrored", () => {
    const { sandbox } = loadAppSandbox();
    const label = vm.runInContext(`artifactOpenControlLabel("example.com")`, sandbox) as string;
    expect(label).toBe(artifactOpenControlLabel("example.com"));
  });
});

describe("ARH-001 D3 static audit — the Viewer reference region", () => {
  /** Everything between the mirrored helpers and the next source-list helper. */
  function referenceRegion(source: string): string {
    const start = source.indexOf("function artifactCitedByText");
    const end = source.indexOf("function sourceListHtml");
    expect(start, "cited-by helper present").toBeGreaterThanOrEqual(0);
    expect(end, "source list helper present").toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("keeps the only navigation a user-activated, opener-safe, host-labeled anchor", () => {
    const region = referenceRegion(APP_JS);
    // Exactly one anchor template, built only under the openable guard, with
    // the opener and referrer protections frozen by scope §3.
    expect(region.match(/<a /g)?.length).toBe(1);
    expect(region).toContain('target="_blank"');
    expect(region).toContain('rel="noopener noreferrer"');
    expect(region).toContain('referrerpolicy="no-referrer"');
    expect(region).toContain("esc(artifactOpenControlLabel(host))");
    expect(region).toContain("if (classification.openable)");
    // The label text itself is the non-color cue: host plus the external
    // boundary words, taken from the shared sentence table.
    expect(APP_JS).toContain(`ARTIFACT_OPEN_CONTROL_SUFFIX = "${ARTIFACT_OPEN_CONTROL_SUFFIX}"`);
    expect(ARTIFACT_OPEN_CONTROL_SUFFIX).toContain("external");
    expect(ARTIFACT_OPEN_CONTROL_SUFFIX).toContain("unverified");
  });

  it("fetches nothing, opens nothing, and previews nothing from the region", () => {
    const region = referenceRegion(APP_JS);
    expect(region).not.toMatch(/fetch\(|window\.open|sendBeacon|location\./);
    expect(region).not.toMatch(/<img|<iframe|<script|<link|<object|<embed|src=/);
    // The readable reference is inert text; inspecting the source shows no
    // automatic navigation from render, hover, or refresh.
    expect(region).toContain("(stored reference, not fetched)");
  });

  it("renders an openable reference with the anchor and zero fetches from the sandbox", () => {
    const { sandbox, fetchCalls } = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    const context = {
      slices: {
        findings: { items: [] },
        artifacts: {
          items: [
            {
              id: "art_openable",
              type: "report",
              title: "Report",
              uriOrPath: "https://example.com/report.html",
            },
          ],
        },
      },
    };
    const html = vm.runInContext(
      `renderSources(el, ${JSON.stringify(context)}); el.innerHTML`,
      sandbox,
    ) as string;
    expect(fetchCalls()).toBe(0);
    expect(html).toContain("class openable https");
    expect(html).toContain("host example.com");
    expect(html).toContain('href="https://example.com/report.html" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"');
    expect(html).toContain(`Open example.com ${ARTIFACT_OPEN_CONTROL_SUFFIX}`);
    expect(html).toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
  });

  it("renders corrected invalid and provider-signed references without open controls", () => {
    const { sandbox, fetchCalls } = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    const context = {
      slices: {
        findings: { items: [] },
        artifacts: {
          items: [
            { id: "art_invalid_port", type: "report", title: "Invalid port", uriOrPath: "https://example.com:99999/report" },
            { id: "art_alias", type: "report", title: "Numeric alias", uriOrPath: "https://127.1/report" },
            { id: "art_signed", type: "report", title: "Signed", uriOrPath: "https://example.com/report?X-Amz-Signature=demo" },
          ],
        },
      },
    };
    const html = vm.runInContext(`renderSources(el, ${JSON.stringify(context)}); el.innerHTML`, sandbox) as string;
    expect(fetchCalls()).toBe(0);
    expect(html).not.toContain("<a ");
    expect(html).toContain("class unparsed");
    expect(html).toContain("class credential-bearing");
    expect(html).toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
  });

  it("keeps unsupported classes inert: no anchor ever, hostile text stays escaped", () => {
    const { sandbox } = loadAppSandbox();
    sandbox.el = { innerHTML: "" };
    const context = {
      slices: {
        findings: { items: [] },
        artifacts: {
          items: [
            {
              id: "art_hostile",
              type: "other",
              title: "Report",
              uriOrPath: 'https://example.com/report"><img src=x onerror=alert(1)>',
            },
            { id: "art_credentialed", type: "other", title: "View", uriOrPath: "https://u:p@example.com/v" },
            { id: "art_path", type: "document", title: "Notes", uriOrPath: "reports/arh-001/working-notes.md" },
            { id: "art_ftp", type: "file", title: "Archive", uriOrPath: "ftp://files.example.com/x.tgz" },
            { id: "art_none", type: "other", title: "Bare", uriOrPath: "" },
          ],
        },
      },
    };
    const html = vm.runInContext(
      `renderSources(el, ${JSON.stringify(context)}); el.innerHTML`,
      sandbox,
    ) as string;
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("onerror=alert(1)>");
    // The hostile markup's quotes never leave text context.
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("class unparsed");
    expect(html).toContain("class credential-bearing");
    expect(html).toContain("class local path");
    expect(html).toContain("class other scheme");
    expect(html).not.toContain("host example.com");
    expect(html).toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
    expect(html).toContain("no reference recorded");
  });
});

describe("ARH-001 D6 — Viewer shell sync and shared labels", () => {
  it("keeps the public copy byte-identical to the source shell", () => {
    expect(PUBLIC_APP_JS).toBe(APP_JS);
  });

  it("keeps the shared reference sentences mirrored in the Viewer source", () => {
    expect(viewerLabelDrift(APP_JS)).toEqual([]);
    expect(viewerLabelDrift(PUBLIC_APP_JS)).toEqual([]);
    expect(APP_JS).toContain(ARTIFACT_EXTERNAL_UNVERIFIED_LABEL);
    expect(APP_JS).toContain(ARTIFACT_UNSAFE_CONTROL_LABEL);
    expect(APP_JS).toContain(ARTIFACT_OPEN_CONTROL_SUFFIX);
  });
});
