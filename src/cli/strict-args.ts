/**
 * Reject options and extra positionals the catalog does not document.
 *
 * The generic parser still records every `--name`. This check runs before a
 * command does work, so a misspelled safety flag cannot be ignored.
 */
import type { CliCommandSpec } from "./catalog.js";
import { ValidationError } from "../domain/errors.js";

const FLAG_NAME = /--([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/g;

/** Options the process reads for every command, including bare `campfire`. */
export const GLOBAL_OPTIONS = [
  "db",
  "token",
  "actor",
  "type",
  "session",
  "harness",
  "output",
  "json",
  "help",
  "version",
  "url",
  "workspace",
] as const;

/** Options bare `campfire` reads when it opens the local console. */
const BARE_OPTIONS = [
  ...GLOBAL_OPTIONS,
  "human-name",
  "host",
  "port",
  "viewer-port",
  "no-connect",
  "no-open",
  "mcp-command",
  "config",
  "theme",
  "all",
] as const;

export function flagsNamedIn(text: string): string[] {
  return [...text.matchAll(FLAG_NAME)].map((match) => match[1]!).filter((name) => name.length > 0);
}

export function acceptedFlagNames(spec: CliCommandSpec): Set<string> {
  const names = new Set<string>(GLOBAL_OPTIONS);
  const texts = [spec.usage, ...(spec.notes ?? []), ...(spec.variants ?? []).map((variant) => variant.usage)];
  for (const text of texts) {
    for (const name of flagsNamedIn(text)) names.add(name);
  }
  return names;
}

/**
 * How many positionals a usage line documents.
 * `undefined` means the line is open-ended (`...`).
 */
export function positionalLimit(usage: string): number | undefined {
  if (usage.includes("...")) return undefined;
  let rest = usage.replace(/^campfire\s+\S+\s*/, "");
  rest = rest.replace(/\[[^\]]*--[^\]]*\]/g, " ");
  rest = rest.replace(/--[A-Za-z0-9-]+(?:[ =]\S+)?/g, " ");
  const tokens = rest.split(/\s+/).filter((token) => token.length > 0 && token !== "|");
  return tokens.length;
}

export function positionalLimitFor(spec: CliCommandSpec, positionals: readonly string[]): number | undefined {
  const head = positionals[0];
  const variant = head === undefined ? undefined : spec.variants?.find((item) => item.selector === head);
  const usages = variant !== undefined ? [variant.usage] : [spec.usage, ...(spec.variants ?? []).map((item) => item.usage)];
  let max = 0;
  for (const usage of usages) {
    const limit = positionalLimit(usage);
    if (limit === undefined) return undefined;
    max = Math.max(max, limit);
  }
  return max;
}

export function assertKnownInvocation(
  spec: CliCommandSpec | undefined,
  parsed: { flags: Record<string, string | boolean>; positionals: readonly string[] },
): void {
  const allowed = spec === undefined ? new Set<string>(BARE_OPTIONS) : acceptedFlagNames(spec);
  const unknown = Object.keys(parsed.flags).filter((name) => !allowed.has(name)).sort();
  if (unknown.length > 0) {
    const option = unknown[0]!;
    const command = spec === undefined ? "campfire" : `campfire ${spec.name}`;
    throw new ValidationError(`${command} does not accept --${option}.`, {
      field: "option",
      option,
      command: spec?.name,
      usage: true,
    });
  }
  if (spec === undefined) return;
  const limit = positionalLimitFor(spec, parsed.positionals);
  if (limit !== undefined && parsed.positionals.length > limit) {
    throw new ValidationError(`${spec.usage} does not take that many arguments.`, {
      field: "positional",
      command: spec.name,
      usage: true,
    });
  }
}
