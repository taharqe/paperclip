import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERP_NAMESPACE, NAMESPACE_SLUG, PLUGIN_ID } from "../src/constants.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_POSTGRES_IDENTIFIER_LENGTH = 63;

/**
 * Mirror of `derivePluginDatabaseNamespace` in
 * server/src/services/plugin-database.ts. The host does not substitute the
 * namespace into migration SQL, so this package must know the literal - and
 * this mirror must be provably identical to the host's implementation.
 */
function derivePluginDatabaseNamespace(pluginKey: string, namespaceSlug?: string): string {
  const hash = createHash("sha256").update(pluginKey).digest("hex").slice(0, 10);
  const slug =
    (namespaceSlug ?? pluginKey)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_")
      .slice(0, 36) || "plugin";
  return `plugin_${slug}_${hash}`.slice(0, MAX_POSTGRES_IDENTIFIER_LENGTH);
}

describe("plugin database namespace", () => {
  it("mirrors the host derivation, proven against a namespace already committed by another plugin", () => {
    // plugin-llm-wiki's migrations hardcode this exact schema name, so it is a
    // known-good output of the host's real algorithm. If our mirror reproduces
    // it, the mirror is correct - and therefore ERP_NAMESPACE is trustworthy.
    expect(derivePluginDatabaseNamespace("paperclipai.plugin-llm-wiki", "llm_wiki")).toBe(
      "plugin_llm_wiki_8f50da974f",
    );
  });

  it("derives ERP_NAMESPACE from the plugin id and slug", () => {
    expect(derivePluginDatabaseNamespace(PLUGIN_ID, NAMESPACE_SLUG)).toBe(ERP_NAMESPACE);
    expect(ERP_NAMESPACE.length).toBeLessThanOrEqual(MAX_POSTGRES_IDENTIFIER_LENGTH);
  });

  it("uses only ERP_NAMESPACE as the schema qualifier in every migration", () => {
    const migrationsDir = path.join(packageRoot, "migrations");
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql"));

    // A migration that hardcodes the wrong schema would either fail loudly or,
    // far worse, write into another plugin's namespace. Assert there is exactly
    // one plugin schema mentioned anywhere and that it is ours.
    expect(files.length, "expected at least one migration").toBeGreaterThan(0);

    for (const file of files) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      const referenced = new Set(sql.match(/plugin_[a-z0-9_]+/g) ?? []);
      expect([...referenced], `${file} references an unexpected plugin schema`).toEqual([
        ERP_NAMESPACE,
      ]);
    }
  });
});
