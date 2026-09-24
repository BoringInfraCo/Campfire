/**
 * Artifact references must survive across machines and harness checkouts.
 *
 * Sprint 002 agents stored harness-absolute paths. Those break the moment two
 * laptops share Campfire. Campfire stores references, not file contents, so the
 * URI itself has to be portable: workspace-relative, or an https URL.
 */
import { isAbsolute, relative } from "node:path";
import { ValidationError } from "./errors.js";

const PORTABLE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function isPortableUrl(value: string): boolean {
  if (!PORTABLE_SCHEME.test(value)) return false;
  // `file:` is an absolute local path in URL clothing. Treat it as a path.
  return !value.toLowerCase().startsWith("file:");
}

/**
 * Normalize an artifact URI/path at write time.
 *
 * Relative paths are kept (posix separators). Absolute paths under `cwd` are
 * rewritten to cwd-relative. Absolute paths outside `cwd`, home-relative
 * (`~...`), and empty strings are rejected.
 */
export function normalizeArtifactUri(uriOrPath: string, cwd: string = process.cwd()): string {
  const raw = uriOrPath.trim();
  if (raw.length === 0) {
    throw new ValidationError("Artifact uriOrPath must not be empty", { field: "uriOrPath" });
  }
  if (raw.startsWith("~")) {
    throw new ValidationError(
      "Artifact uriOrPath must be workspace-relative or an https URL; home-relative paths do not survive across machines",
      { field: "uriOrPath", uriOrPath: raw },
    );
  }
  if (isPortableUrl(raw)) {
    return raw;
  }

  const path = raw.replaceAll("\\", "/");
  if (!isAbsolute(path)) {
    return path;
  }

  const relativePath = relative(cwd, path).replaceAll("\\", "/");
  if (relativePath.length === 0) {
    throw new ValidationError(
      "Artifact uriOrPath must be workspace-relative or an https URL; the workspace root is not a valid artifact reference",
      { field: "uriOrPath", uriOrPath: raw },
    );
  }
  if (relativePath.startsWith("../") || isAbsolute(relativePath)) {
    throw new ValidationError(
      "Artifact uriOrPath must be workspace-relative or an https URL; absolute paths do not survive across machines",
      { field: "uriOrPath", uriOrPath: raw },
    );
  }
  return relativePath;
}
