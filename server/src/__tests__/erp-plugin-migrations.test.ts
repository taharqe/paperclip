import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  derivePluginDatabaseNamespace,
  splitSqlStatements,
  validatePluginMigrationStatement,
} from "../services/plugin-database.js";

/**
 * Pre-flight for the Industrial ERP plugin's migrations.
 *
 * The host only validates plugin SQL at install time, on a live database. This
 * runs the *same* production validator over every statement in the committed
 * migration files, so an illegal statement fails here instead of bricking a
 * plugin install. It needs no database and therefore runs everywhere, including
 * hosts where embedded Postgres cannot start.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const erpPackageRoot = path.join(repoRoot, "packages/plugins/plugin-erp-core");
const migrationsDir = path.join(erpPackageRoot, "migrations");

const ERP_PLUGIN_ID = "paperclipai.plugin-erp-core";
const ERP_NAMESPACE_SLUG = "erp_core";
const ERP_CORE_READ_TABLES = [
  "companies",
  "projects",
  "agents",
  "issues",
  "approvals",
  "heartbeat_runs",
  "assets",
] as const;

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

describe("plugin-erp-core migrations", () => {
  it("hardcodes the namespace the host will actually derive", () => {
    const namespace = derivePluginDatabaseNamespace(ERP_PLUGIN_ID, ERP_NAMESPACE_SLUG);
    expect(namespace).toBe("plugin_erp_core_b9375856a1");

    for (const file of migrationFiles()) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      const referenced = new Set(sql.match(/plugin_[a-z0-9_]+/g) ?? []);
      // Exactly one plugin schema may appear, and it must be ours. Writing into
      // another plugin's namespace would be a silent cross-plugin data leak.
      expect([...referenced], `${file} references an unexpected plugin schema`).toEqual([namespace]);
    }
  });

  it("passes every statement through the production migration validator", () => {
    const namespace = derivePluginDatabaseNamespace(ERP_PLUGIN_ID, ERP_NAMESPACE_SLUG);
    const files = migrationFiles();
    expect(files.length, "expected at least one migration file").toBeGreaterThan(0);

    let checked = 0;
    for (const file of files) {
      const statements = splitSqlStatements(readFileSync(path.join(migrationsDir, file), "utf8"));
      expect(statements.length, `${file} is empty`).toBeGreaterThan(0);

      for (const statement of statements) {
        expect(
          () => validatePluginMigrationStatement(statement, namespace, ERP_CORE_READ_TABLES),
          `${file}: ${statement.slice(0, 160).replace(/\s+/g, " ")}`,
        ).not.toThrow();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps apostrophes out of SQL comments", () => {
    // The host normalises a statement for its keyword scan by stripping quoted
    // literals BEFORE stripping comments, so a lone apostrophe in a comment
    // opens a phantom string that swallows the real SQL after it. The statement
    // then normalises to "" and is rejected with a misleading "may contain DDL
    // or namespace-scoped backfill statements only". Cheap to avoid, confusing
    // to debug - so assert it up front.
    for (const file of migrationFiles()) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      const offending = sql
        .split("\n")
        .map((line, index) => ({ line, lineNo: index + 1 }))
        .filter(({ line }) => line.trimStart().startsWith("--") && line.includes("'"));
      expect(
        offending.map(({ lineNo, line }) => `${file}:${lineNo} ${line.trim()}`),
        "apostrophes in SQL comments break the host keyword scan",
      ).toEqual([]);
    }
  });

  it("scopes every table to a company and never foreign-keys the mutable assets table", () => {
    const sql = migrationFiles()
      .map((file) => readFileSync(path.join(migrationsDir, file), "utf8"))
      .join("\n");

    const createdTables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_.]+)\s*\(([\s\S]*?)\n\);/gi)];
    expect(createdTables.length).toBeGreaterThan(0);

    for (const [, table, body] of createdTables) {
      // Core has no row-level security, so tenancy is entirely our discipline.
      expect(body, `${table} must be company scoped`).toMatch(
        /company_id uuid NOT NULL REFERENCES public\.companies\(id\) ON DELETE CASCADE/,
      );
    }

    // Core deletes asset rows in several paths. A CASCADE would let one of those
    // destroy a document-control record; a RESTRICT would break company deletion.
    expect(sql).not.toMatch(/REFERENCES\s+public\.assets/i);
    expect(sql).toMatch(/asset_sha256 text NOT NULL/);
  });

  it("keeps approval-payload-bound identifiers clear of the redaction pattern", () => {
    // server/src/redaction.ts replaces any key matching token/secret/key/auth/...
    // with a redacted marker on every approvals response. A gate identifier that
    // matched would come back unreadable and break the release link step.
    const secretish =
      /[A-Za-z0-9_-]*(?:api[-_]?key|access[-_]?token|auth(?:_?token)?|token|authorization|bearer|secret|passwd|password|credential|jwt|private[-_]?key|cookie|connectionstring)[A-Za-z0-9_-]*/i;
    const sql = migrationFiles()
      .map((file) => readFileSync(path.join(migrationsDir, file), "utf8"))
      .join("\n");

    const gateColumns = [...sql.matchAll(/^\s{2}(gate_[a-z0-9_]+)/gim)].map((match) => match[1]!);
    expect(gateColumns).toContain("gate_ref");
    for (const column of gateColumns) {
      expect(secretish.test(column), `${column} would be redacted in an approval payload`).toBe(false);
    }
  });
});
