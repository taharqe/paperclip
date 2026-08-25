import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as db from "@paperclipai/db";

/**
 * Invariants the ERP schema must hold.
 *
 * Core has no row-level security and no repository layer, so tenant isolation
 * is entirely a matter of discipline. These tests make the discipline
 * enforceable rather than aspirational.
 */

/**
 * Listed explicitly rather than scanned from the module, so adding an ERP table
 * without also subjecting it to these invariants has to be a deliberate edit.
 */
const ERP_TABLES: Array<[string, PgTable]> = [
  ["erpDocuments", db.erpDocuments],
  ["erpDocumentRevisions", db.erpDocumentRevisions],
  ["erpExtractionRuns", db.erpExtractionRuns],
  ["erpExtractedValues", db.erpExtractedValues],
  ["erpRevisionDiffs", db.erpRevisionDiffs],
  ["erpRevisionDiffEntries", db.erpRevisionDiffEntries],
  ["erpStateTransitions", db.erpStateTransitions],
  ["erpReleaseGates", db.erpReleaseGates],
  ["erpRoleGrants", db.erpRoleGrants],
  ["erpOperations", db.erpOperations],
];

describe("ERP schema", () => {
  it("covers every erp* table the db package exports", () => {
    // Guards against a new table being added to the schema but skipped here.
    const exported = Object.keys(db)
      .filter((name) => /^erp[A-Z]/.test(name))
      .sort();
    expect(ERP_TABLES.map(([name]) => name).sort()).toEqual(exported);

    const names = ERP_TABLES.map(([, table]) => getTableConfig(table).name).sort();
    expect(names).toEqual([
      "erp_document_revisions",
      "erp_documents",
      "erp_extracted_values",
      "erp_extraction_runs",
      "erp_operations",
      "erp_release_gates",
      "erp_revision_diff_entries",
      "erp_revision_diffs",
      "erp_role_grants",
      "erp_state_transitions",
    ]);
  });

  it("scopes every table to a company and cascades on company deletion", () => {
    for (const [exportName, table] of ERP_TABLES) {
      const config = getTableConfig(table);
      const companyId = config.columns.find((column) => column.name === "company_id");
      expect(companyId, `${exportName} has no company_id`).toBeDefined();
      expect(companyId?.notNull, `${exportName}.company_id must be NOT NULL`).toBe(true);

      const companyFk = config.foreignKeys.find((fk) =>
        fk.reference().columns.some((column) => column.name === "company_id"),
      );
      expect(companyFk, `${exportName} does not foreign-key company_id`).toBeDefined();
      expect(
        companyFk?.onDelete,
        `${exportName}.company_id should cascade so company deletion stays possible`,
      ).toBe("cascade");
    }
  });

  it("leads every index with company_id, so no query can accidentally scan across tenants", () => {
    for (const [exportName, table] of ERP_TABLES) {
      const config = getTableConfig(table);
      for (const index of [...config.indexes, ...config.uniqueConstraints]) {
        const columns = "config" in index ? index.config.columns : index.columns;
        const first = columns[0] as { name?: string } | undefined;
        expect(
          first?.name,
          `${exportName}: index ${JSON.stringify(
            "config" in index ? index.config.name : index.name,
          )} should lead with company_id`,
        ).toBe("company_id");
      }
    }
  });

  it("never foreign-keys the mutable assets table", () => {
    // Core deletes asset rows when replacing a logo or attachment, and when
    // deleting a company. A cascade would let one of those silently destroy a
    // document-control record; a restrict would break company deletion, which
    // deletes assets before the company row. The audit record must outlive the
    // blob, so the checksum is denormalised instead.
    for (const [exportName, table] of ERP_TABLES) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        const target = fk.reference().foreignTable;
        expect(
          getTableConfig(target).name,
          `${exportName} must not foreign-key assets`,
        ).not.toBe("assets");
      }
    }

    const revisions = getTableConfig(db.erpDocumentRevisions);
    // The denormalised fingerprint that replaces the foreign key.
    for (const column of ["asset_id", "asset_sha256", "asset_byte_size", "asset_content_type"]) {
      const found = revisions.columns.find((entry) => entry.name === column);
      expect(found, `erp_document_revisions.${column} is missing`).toBeDefined();
      expect(found?.notNull, `erp_document_revisions.${column} must be NOT NULL`).toBe(true);
    }
  });

  it("constrains every closed-set column at the database level", () => {
    // Porting this schema from hand-written SQL to Drizzle silently dropped
    // every CHECK constraint once: the columns and indexes came across, the
    // checks did not, and `confidence: 5` was accepted until an integration
    // test caught it. Application code is not a substitute for a constraint -
    // the database is the last line that always runs.
    const expected: Record<string, string[]> = {
      erpDocuments: ["erp_documents_lifecycle_ck", "erp_documents_created_by_kind_ck"],
      erpDocumentRevisions: ["erp_revisions_state_ck", "erp_revisions_byte_size_ck"],
      erpExtractionRuns: ["erp_extraction_runs_method_ck", "erp_extraction_runs_status_ck"],
      erpExtractedValues: [
        "erp_values_origin_ck",
        "erp_values_review_ck",
        "erp_values_confidence_ck",
      ],
      erpRevisionDiffEntries: ["erp_diff_entries_kind_ck"],
      erpStateTransitions: ["erp_transitions_actor_kind_ck"],
      erpReleaseGates: ["erp_gates_status_ck"],
      erpRoleGrants: ["erp_role_grants_principal_kind_ck", "erp_role_grants_role_ck"],
      erpOperations: ["erp_operations_status_ck"],
    };

    for (const [exportName, table] of ERP_TABLES) {
      const wanted = expected[exportName] ?? [];
      const actual = getTableConfig(table).checks.map((entry) => entry.name);
      for (const name of wanted) {
        expect(actual, `${exportName} is missing CHECK ${name}`).toContain(name);
      }
    }
  });

  it("keeps approval-payload-bound identifiers clear of the redaction pattern", () => {
    // server/src/redaction.ts replaces any key matching token/secret/key/auth
    // on every approvals response, so a token-named gate identifier would come
    // back unreadable and break the release link step.
    const secretish =
      /[A-Za-z0-9_-]*(?:api[-_]?key|access[-_]?token|auth(?:_?token)?|token|authorization|bearer|secret|passwd|password|credential|jwt|private[-_]?key|cookie|connectionstring)[A-Za-z0-9_-]*/i;
    const gates = getTableConfig(db.erpReleaseGates);
    const gateColumns = gates.columns.map((column) => column.name).filter((name) => name.startsWith("gate_"));
    expect(gateColumns).toContain("gate_ref");
    for (const column of gateColumns) {
      expect(secretish.test(column), `${column} would be redacted in an approval payload`).toBe(
        false,
      );
    }
  });
});
