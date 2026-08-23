#!/usr/bin/env node
/**
 * Print the Postgres schema name the host will allocate to this plugin.
 *
 * The host derives the namespace from the plugin id and slug and does NOT
 * substitute it into migration SQL - every migration file must hardcode the
 * literal. Run this, paste the value, and let tests/namespace.spec.ts keep the
 * two in sync. A mismatch here is a silent cross-plugin data leak, so the
 * algorithm below is a deliberate mirror of
 * `derivePluginDatabaseNamespace` in server/src/services/plugin-database.ts.
 */
import { createHash } from "node:crypto";

const MAX_POSTGRES_IDENTIFIER_LENGTH = 63;

export function derivePluginDatabaseNamespace(pluginKey, namespaceSlug) {
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

export const PLUGIN_ID = "paperclipai.plugin-erp-core";
export const NAMESPACE_SLUG = "erp_core";

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${derivePluginDatabaseNamespace(PLUGIN_ID, NAMESPACE_SLUG)}\n`);
}
