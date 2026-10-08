/**
 * CLI argument parsing (CLI-001).
 *
 * `flags` keeps the last value for a repeated flag so existing behavior is
 * unchanged. `occurrences` keeps every value so output-mode conflicts can be
 * detected without guessing.
 */
export interface ParsedArgs {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
  occurrences: Record<string, Array<string | boolean>>;
}

const BOOLEAN_FLAGS = new Set([
  "reset",
  "enroll",
  "allow-loopback",
  "help",
  "json",
  "full",
  "allow-remote",
  "connect",
  "no-connect",
  "open",
  "no-open",
  "with-playbook",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const occurrences: Record<string, Array<string | boolean>> = {};

  const record = (name: string, value: string | boolean): void => {
    flags[name] = value;
    const seen = occurrences[name];
    if (seen === undefined) {
      occurrences[name] = [value];
    } else {
      seen.push(value);
    }
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === "-h") {
      record("help", true);
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        record(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      if (BOOLEAN_FLAGS.has(body)) {
        record(body, true);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        record(body, next);
        i += 1;
      } else {
        record(body, true);
      }
    } else {
      positionals.push(token);
    }
  }

  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags, occurrences };
}

export function optionalString(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = flags[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value;
}
