import { describe, expect, it } from "vitest";
import {
  READ_STATEMENTS,
  WRITE_STATEMENTS,
} from "../../../packages/plugins/plugin-erp-core/src/erp/sql.js";
import { ERP_NAMESPACE } from "../../../packages/plugins/plugin-erp-core/src/constants.js";
import {
  validatePluginRuntimeExecute,
  validatePluginRuntimeQuery,
} from "../services/plugin-database.js";

/**
 * Push every SQL statement the ERP worker can run through the host's real
 * runtime validators.
 *
 * The host validates plugin SQL at call time, so an illegal statement would
 * otherwise surface as a 500 the first time a particular code path runs -
 * possibly long after merge. This turns that into a test failure. No database
 * required, so it runs everywhere.
 */

const CORE_READ_TABLES = [
  "companies",
  "projects",
  "agents",
  "issues",
  "approvals",
  "assets",
] as const;

describe("plugin-erp-core runtime SQL", () => {
  it("has statements to check", () => {
    expect(Object.keys(READ_STATEMENTS).length).toBeGreaterThan(5);
    expect(Object.keys(WRITE_STATEMENTS).length).toBeGreaterThan(10);
  });

  it("accepts every read statement as a namespace-scoped query", () => {
    for (const [name, sql] of Object.entries(READ_STATEMENTS)) {
      expect(
        () => validatePluginRuntimeQuery(sql, ERP_NAMESPACE, CORE_READ_TABLES),
        `${name} was rejected`,
      ).not.toThrow();
    }
  });

  it("accepts every write statement as a namespace-scoped execute", () => {
    for (const [name, sql] of Object.entries(WRITE_STATEMENTS)) {
      expect(
        () => validatePluginRuntimeExecute(sql, ERP_NAMESPACE),
        `${name} was rejected`,
      ).not.toThrow();
    }
  });

  it("never lets a write reach outside the plugin namespace", () => {
    // `execute` may not reference public at all - the host enforces it, but
    // asserting here makes the intent explicit and catches a bad edit early.
    for (const [name, sql] of Object.entries(WRITE_STATEMENTS)) {
      expect(sql, `${name} references public`).not.toMatch(/\bpublic\./);
    }
  });

  it("parameterises every statement rather than interpolating values", () => {
    for (const [name, sql] of Object.entries({ ...READ_STATEMENTS, ...WRITE_STATEMENTS })) {
      // The only interpolation permitted is the namespace itself, which is a
      // compile-time constant, never user input.
      const withoutNamespace = sql.split(ERP_NAMESPACE).join("");
      expect(withoutNamespace, `${name} appears to interpolate a value`).not.toMatch(/\$\{/);
    }
  });

  it("qualifies every plugin table with the derived namespace", () => {
    for (const [name, sql] of Object.entries({ ...READ_STATEMENTS, ...WRITE_STATEMENTS })) {
      const schemas = new Set(sql.match(/plugin_[a-z0-9_]+/g) ?? []);
      for (const schema of schemas) {
        expect(schema, `${name} references a foreign plugin schema`).toBe(ERP_NAMESPACE);
      }
      // A bare erp_ table in table position would resolve against the
      // search_path rather than our schema - a silent correctness bug. Only
      // table position counts; `erp_role` is a legitimate column name.
      const bareTables = [
        ...sql.matchAll(/\b(from|join|into|update)\s+(erp_[a-z_]+)/gi),
      ].map((match) => match[2]!);
      expect(bareTables, `${name} has unqualified table references`).toEqual([]);
    }
  });
});
