import { describe, expect, it } from "vitest";
import { normalizeArtifactUri } from "../../src/domain/artifacts.js";
import { ValidationError } from "../../src/domain/errors.js";

const CWD = "/workspace/Campfire";

describe("normalizeArtifactUri", () => {
  it("keeps workspace-relative paths", () => {
    expect(normalizeArtifactUri("fixtures/billing/migration-284.sql", CWD)).toBe(
      "fixtures/billing/migration-284.sql",
    );
  });

  it("keeps portable https URLs", () => {
    expect(normalizeArtifactUri("https://github.com/org/repo/blob/main/foo.sql", CWD)).toBe(
      "https://github.com/org/repo/blob/main/foo.sql",
    );
  });

  it("rewrites absolute paths under cwd to relative paths", () => {
    expect(normalizeArtifactUri(`${CWD}/fixtures/billing/migration-284.sql`, CWD)).toBe(
      "fixtures/billing/migration-284.sql",
    );
  });

  it("rejects absolute paths outside cwd", () => {
    expect(() => normalizeArtifactUri("/tmp/secret.sql", CWD)).toThrow(ValidationError);
  });

  it("rejects home-relative paths", () => {
    expect(() => normalizeArtifactUri("~/notes.md", CWD)).toThrow(ValidationError);
  });

  it("rejects empty values", () => {
    expect(() => normalizeArtifactUri("  ", CWD)).toThrow(ValidationError);
  });
});
