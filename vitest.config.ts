import { readFile } from "node:fs/promises";
import { defineConfig, type Plugin } from "vitest/config";

// Inline SQL imports as text. Mirrors the wrangler Text rule for SQL files
// so src/worker/schema.ts bundles schema.sql without node:fs. Test-only;
// production Workers use wrangler's bundler.
function sqlText(): Plugin {
  return {
    name: "campfire-sql-text",
    enforce: "pre",
    async load(id: string) {
      const path = id.split("?")[0] as string;
      if (!path.endsWith(".sql")) return null;
      const text = await readFile(path, "utf8");
      return `export default ${JSON.stringify(text)};`;
    },
  };
}

export default defineConfig({
  plugins: [sqlText()],
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "forks",
    fileParallelism: false,
  },
});
