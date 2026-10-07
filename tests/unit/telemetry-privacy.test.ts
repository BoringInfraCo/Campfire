import { describe, expect, it } from "vitest";
import {
  buildTelemetryEvent,
  parseTelemetryEventV1,
  PROHIBITED_FIELD_NAMES,
  serializeTelemetryEvent,
  TELEMETRY_FIELDS,
  TELEMETRY_MAX_PAYLOAD_BYTES,
  TELEMETRY_SCHEMA_VERSION,
  telemetryDataPoint,
  type TelemetryEventName,
} from "../../src/telemetry/contract.js";

/**
 * TEL-001 privacy regression (sprint section 18, "Privacy Regression").
 *
 * Sprint section 11 lists what telemetry must never intentionally contain, and
 * section 17 requires that "privacy tests prove prohibited data cannot enter
 * serialized events". This file is that proof, and it is deliberately the most
 * hostile of the suite: every fixture below is a string a real Campfire call
 * could be handed — a repository name, a workspace name, a file path, a prompt,
 * a code snippet, a token, a username, an email address, a hostname, a branch,
 * a git remote — and for each one the same three questions are asked:
 *
 *   1. Can the string reach a serialized payload at all?
 *   2. Is the serialized payload exactly the documented key set?
 *   3. Would the ingestion endpoint accept it as an extra field?
 *
 * Every fixture value is obviously synthetic (`example-repo`,
 * `demo@example.invalid`, `REDACTED`), and none resembles a credential: this
 * repository's public-release audit hard-fails on real-looking secrets and on
 * absolute user home paths, and a test fixture has no business tripping those.
 */

const ID_A = "11111111-2222-4333-8444-555555555555";

/** Content a caller could plausibly hold when it reports an event. */
const HOSTILE_FIXTURES: Array<{ label: string; value: string }> = [
  { label: "repository name", value: "example-repo" },
  { label: "workspace name", value: "example-workspace-quarterly-planning" },
  { label: "organization name", value: "example-org" },
  { label: "file path", value: "/srv/build/example-repo/src/telemetry/leak.ts" },
  { label: "windows file path", value: "D:\\builds\\example-repo\\src\\main.ts" },
  { label: "filename", value: "example-quarterly-plan.md" },
  { label: "prompt", value: "Please refactor the billing service in example-repo before Friday." },
  { label: "agent message", value: "I read the workspace and found example-repo has no goal." },
  { label: "code snippet", value: "const total = items.reduce((sum, item) => sum + item.amount, 0);" },
  { label: "diff", value: "-  const answer = 41;\n+  const answer = 42;" },
  { label: "api token", value: "example-api-key-value-REDACTED-not-real" },
  { label: "bearer token", value: "Bearer REDACTED-example-bearer-token" },
  { label: "username", value: "example-operator" },
  { label: "email address", value: "demo@example.invalid" },
  { label: "hostname", value: "example-host.invalid" },
  { label: "mac address", value: "de:ad:be:ef:00:01" },
  { label: "branch name", value: "feature/example-repo-redesign" },
  { label: "git remote url", value: "https://git.example.invalid/example-org/example-repo.git" },
  { label: "finding summary", value: "example-repo deploys fail on every Friday" },
  { label: "goal title", value: "Make example-repo ship on time" },
  { label: "command with content", value: "campfire add-finding example-repo \"fix the deploy\"" },
];

/** Every allow-listed field of a fully populated event. */
const FULL_KEY_SET = [...TELEMETRY_FIELDS].sort();

function keysOf(payload: unknown): string[] {
  return Object.keys(payload as Record<string, unknown>).sort();
}

/** An event carrying every documented dimension. */
function fullEvent(overrides: Record<string, unknown> = {}): ReturnType<typeof buildTelemetryEvent> {
  return buildTelemetryEvent({
    event: "active",
    installationId: ID_A,
    campfireVersion: "1.9.1",
    os: "darwin",
    arch: "arm64",
    installMethod: "curl",
    surface: "cli",
    ...overrides,
  } as Parameters<typeof buildTelemetryEvent>[0]);
}

describe("allow-list and prohibited-list hygiene", () => {
  it("keeps the prohibited field names disjoint from the telemetry fields", () => {
    const allowed = new Set<string>(TELEMETRY_FIELDS);
    const overlap = PROHIBITED_FIELD_NAMES.filter((name) => allowed.has(name));
    expect(overlap).toEqual([]);
  });

  it("still names every category the sprint prohibits", () => {
    // A future edit that empties the list must fail here, not silently pass the
    // disjointness check above.
    const prohibited = new Set<string>(PROHIBITED_FIELD_NAMES);
    for (const required of [
      "ip",
      "location",
      "email",
      "username",
      "hostname",
      "fingerprint",
      "workspace",
      "repo",
      "branch",
      "remoteUrl",
      "path",
      "filename",
      "prompt",
      "message",
      "code",
      "diff",
      "goal",
      "task",
      "finding",
      "decision",
      "artifact",
      "contribution",
      "token",
      "secret",
      "apiKey",
      "credential",
    ]) {
      expect(prohibited.has(required), required).toBe(true);
    }
    expect(PROHIBITED_FIELD_NAMES.length).toBeGreaterThanOrEqual(40);
  });

  it("keeps the field list stable and versioned", () => {
    expect([...TELEMETRY_FIELDS]).toEqual([
      "schemaVersion",
      "event",
      "campfireVersion",
      "os",
      "arch",
      "installMethod",
      "surface",
      "installationId",
    ]);
    expect(TELEMETRY_SCHEMA_VERSION).toBe(1);
    expect(TELEMETRY_MAX_PAYLOAD_BYTES).toBe(2_048);
  });
});

describe("hostile content cannot enter a serialized payload", () => {
  it.each(HOSTILE_FIXTURES)("drops $label from the serialized event", ({ value }) => {
    // (1a) As an undocumented property on the builder input.
    const viaExtraKeys = serializeTelemetryEvent(
      fullEvent({
        repository: value,
        repo: value,
        workspace: value,
        workspaceName: value,
        workspaceId: value,
        path: value,
        file: value,
        filename: value,
        prompt: value,
        message: value,
        code: value,
        diff: value,
        content: value,
        goal: value,
        task: value,
        finding: value,
        decision: value,
        artifact: value,
        contribution: value,
        command: value,
        args: [value],
        token: value,
        secret: value,
        apiKey: value,
        credential: value,
        email: value,
        username: value,
        hostname: value,
        host: value,
        fingerprint: value,
        mac: value,
        branch: value,
        remoteUrl: value,
        ip: value,
        location: value,
      }),
    );

    // (1b) Spread onto the object handed straight to the serializer.
    const viaSpread = serializeTelemetryEvent({
      ...fullEvent(),
      ...Object.fromEntries(HOSTILE_FIXTURES.map((fixture) => [fixture.label, fixture.value])),
    } as Parameters<typeof serializeTelemetryEvent>[0]);

    // (1c) In every closed-vocabulary slot, where it must normalize away.
    const viaVocabulary = serializeTelemetryEvent(
      fullEvent({ os: value, arch: value, installMethod: value, surface: value, installationId: value }),
    );

    for (const [label, body] of [
      ["extra keys", viaExtraKeys],
      ["spread", viaSpread],
    ] as const) {
      expect(body, `${label}: ${value}`).not.toContain(value);
      expect(body, `${label}: ${value}`).not.toContain(value.slice(0, 12));
      // (2) The key set is exactly the documented one, whatever was thrown in.
      expect(keysOf(JSON.parse(body)), `${label}: ${value}`).toEqual(FULL_KEY_SET);
    }

    // (1c) In a closed-vocabulary slot the value must normalize away entirely.
    expect(viaVocabulary, value).not.toContain(value);
    expect(keysOf(JSON.parse(viaVocabulary)).every((key) => (TELEMETRY_FIELDS as readonly string[]).includes(key))).toBe(true);

    // The dimension that IS caller-supplied free text is the version, and it is
    // bounded: a payload cannot hide in it at full length.
    const viaVersion = buildTelemetryEvent({
      event: "activated",
      installationId: ID_A,
      campfireVersion: value,
      os: "linux",
      arch: "x64",
    });
    expect(viaVersion.campfireVersion.length).toBeLessThanOrEqual(32);
  });

  it("emits only allow-listed keys for every documented event", () => {
    const events: TelemetryEventName[] = ["install_requested", "install_completed", "activated", "active"];
    for (const event of events) {
      const payload = JSON.parse(serializeTelemetryEvent(fullEvent({ event }))) as Record<string, unknown>;
      for (const key of keysOf(payload)) {
        expect(TELEMETRY_FIELDS as readonly string[]).toContain(key);
      }
      expect(payload.event).toBe(event);
    }
  });

  it("rejects a payload carrying any prohibited field as a key", () => {
    const base = {
      schemaVersion: 1,
      event: "activated",
      installationId: ID_A,
      campfireVersion: "1.9.1",
      os: "darwin",
      arch: "arm64",
      surface: "cli",
    };
    for (const name of PROHIBITED_FIELD_NAMES) {
      const parsed = parseTelemetryEventV1({ ...base, [name]: HOSTILE_FIXTURES[0]!.value });
      expect(parsed, name).toEqual({ ok: false, reason: "unknown_field" });
    }
  });

  it("normalizes hostile content out of a legal slot instead of storing it", () => {
    const base = {
      schemaVersion: 1,
      event: "activated",
      installationId: ID_A,
      campfireVersion: "1.9.1",
      os: "darwin",
      arch: "arm64",
    };
    // Enum slots are closed: an undocumented surface is dropped, not stored.
    const surface = parseTelemetryEventV1({ ...base, surface: "demo@example.invalid" });
    expect(surface.ok).toBe(true);
    if (!surface.ok) throw new Error("expected acceptance");
    expect(surface.event.surface).toBeUndefined();

    // A non-UUID identity cannot be a hostname, a path, or a username.
    expect(parseTelemetryEventV1({ ...base, installationId: "example-host.invalid" }).ok).toBe(false);

    // os/arch are normalized to the documented vocabulary, so a repository name
    // in the os slot can never become a stored dimension.
    const os = parseTelemetryEventV1({ ...base, os: "example-repo" });
    expect(os.ok).toBe(true);
    if (!os.ok) throw new Error("expected acceptance");
    expect(os.event.os).toBe("unknown");
    expect(JSON.stringify(os.event)).not.toContain("example-repo");
  });
});

describe("analytics engine dimensions carry no content", () => {
  it("keeps one sampling index and the seven dimensions plus the id in blobs", () => {
    const point = telemetryDataPoint(
      buildTelemetryEvent({
        event: "active",
        installationId: ID_A,
        campfireVersion: "1.9.1",
        os: "darwin",
        arch: "arm64",
        installMethod: "curl",
        surface: "mcp",
      }),
    );
    // The index is only the sampling key. A UUID here would sample each
    // installation separately, so the id stays blob8.
    expect(point.indexes).toEqual(["active"]);
    expect(point.indexes).toHaveLength(1);
    expect(point.blobs).toEqual(["active", "1", "1.9.1", "darwin", "arm64", "curl", "mcp", ID_A]);
    expect(point.blobs).toHaveLength(8);
    expect(point.blobs[0]).toBe(point.indexes[0]);
    expect(point.blobs[1]).toBe("1");
    expect(point.blobs[7]).toBe(ID_A);
  });

  it("records none as the value of an inapplicable dimension rather than a leak", () => {
    const point = telemetryDataPoint(buildTelemetryEvent({ event: "install_requested" }));
    expect(point.indexes).toEqual(["install_requested"]);
    expect(point.indexes).toHaveLength(1);
    expect(point.blobs).toEqual(["install_requested", "1", "unknown", "unknown", "unknown", "none", "none", ""]);
    expect(point.blobs).toHaveLength(8);
    expect(point.blobs[0]).toBe(point.indexes[0]);
    expect(point.blobs[1]).toBe("1");
    expect(point.blobs[7]).toBe("");
  });

  it("keeps blob positions stable for every event name", () => {
    const events: TelemetryEventName[] = ["install_requested", "install_completed", "activated", "active"];
    for (const event of events) {
      const point = telemetryDataPoint(fullEvent({ event }));
      expect(point.indexes, event).toEqual([event]);
      expect(point.indexes, event).toHaveLength(1);
      expect(point.blobs, event).toHaveLength(8);
      expect(point.blobs[0], event).toBe(point.indexes[0]);
      expect(point.blobs[1], event).toBe("1");
      // `fullEvent` always carries an installation id. The empty-id case is
      // the install_requested assertion above; this loop locks blob8's slot.
      expect(point.blobs[7], event).toBe(ID_A);
    }
  });
});

describe("payload ceiling", () => {
  it("stays under the ingestion limit even with a 10,000 character version string", () => {
    const body = serializeTelemetryEvent(
      buildTelemetryEvent({
        event: "install_completed",
        installationId: ID_A,
        campfireVersion: "9".repeat(10_000),
        os: "linux",
        arch: "x64",
        installMethod: "curl",
        surface: "agent",
      }),
    );
    expect(new TextEncoder().encode(body).length).toBeLessThan(TELEMETRY_MAX_PAYLOAD_BYTES);
    expect(body.length).toBeLessThan(512);
  });

  it("stays under the limit for every documented event and surface", () => {
    for (const event of ["install_requested", "install_completed", "activated", "active"] as const) {
      for (const surface of [undefined, "cli", "agent", "mcp"] as const) {
        const body = serializeTelemetryEvent(
          buildTelemetryEvent({ event, installationId: ID_A, campfireVersion: "1.9.1", surface }),
        );
        expect(new TextEncoder().encode(body).length, `${event}/${String(surface)}`).toBeLessThan(TELEMETRY_MAX_PAYLOAD_BYTES);
      }
    }
  });
});
