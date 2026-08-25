import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { companies } from "../companies.js";
import { projects } from "../projects.js";
import { agents } from "../agents.js";
import { issues } from "../issues.js";
import { approvals } from "../approvals.js";
import { heartbeatRuns } from "../heartbeat_runs.js";

/**
 * Industrial ERP - document control and engineering data provenance.
 *
 * Every table is company-scoped. Core has no row-level security, so tenancy is
 * enforced by a `company_id` predicate in every query, including single-row
 * reads, and by a leading-`company_id` index on every access path.
 *
 * Deliberate omission: revisions reference an asset by id but carry **no
 * foreign key** to `assets`. Core deletes asset rows in several paths -
 * replacing a company logo, replacing an attachment, deleting a company. A
 * cascade would let one of those silently destroy a document-control record,
 * and a restrict would break company deletion, which deletes assets before the
 * company row. A document-control record must outlive its blob, so the
 * checksum, size, content type and filename are denormalised here instead.
 */

/** The document register. One row per controlled document, many revisions. */
export const erpDocuments = pgTable(
  "erp_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    docNumber: text("doc_number").notNull(),
    title: text("title").notNull(),
    docType: text("doc_type").notNull(),
    discipline: text("discipline"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    partyRef: text("party_ref"),
    lifecycleStatus: text("lifecycle_status").notNull().default("active"),
    currentRevisionId: uuid("current_revision_id"),
    releasedRevisionId: uuid("released_revision_id"),
    createdByKind: text("created_by_kind").notNull().default("user"),
    createdById: text("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    numberUq: uniqueIndex("erp_documents_number_uq").on(table.companyId, table.docNumber),
    companyUpdatedIdx: index("erp_documents_company_updated_idx").on(
      table.companyId,
      table.updatedAt,
    ),
    companyProjectIdx: index("erp_documents_company_project_idx").on(
      table.companyId,
      table.projectId,
    ),
    companyTypeIdx: index("erp_documents_company_type_idx").on(table.companyId, table.docType),
    lifecycleCk: check(
      "erp_documents_lifecycle_ck",
      sql`${table.lifecycleStatus} in ('active', 'superseded', 'withdrawn')`,
    ),
    createdByKindCk: check(
      "erp_documents_created_by_kind_ck",
      sql`${table.createdByKind} in ('user', 'agent', 'plugin')`,
    ),
  }),
);

/** Revision A, B, C... of a document. The unit that carries a review state. */
export const erpDocumentRevisions = pgTable(
  "erp_document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => erpDocuments.id, { onDelete: "cascade" }),
    revisionCode: text("revision_code").notNull(),
    revisionOrdinal: integer("revision_ordinal").notNull(),
    reviewState: text("review_state").notNull().default("DRAFT"),
    supersedesRevisionId: uuid("supersedes_revision_id").references(
      (): AnyPgColumn => erpDocumentRevisions.id,
      { onDelete: "set null" },
    ),
    /** Points at `assets.id`. Intentionally not a foreign key - see file header. */
    assetId: uuid("asset_id").notNull(),
    assetSha256: text("asset_sha256").notNull(),
    assetByteSize: bigint("asset_byte_size", { mode: "number" }).notNull(),
    assetContentType: text("asset_content_type").notNull(),
    assetFilename: text("asset_filename"),
    /** Set once an agent has fetched the bytes and confirmed the checksum. */
    assetVerifiedAt: timestamp("asset_verified_at", { withTimezone: true }),
    assetVerifiedSha256: text("asset_verified_sha256"),
    pageCount: integer("page_count"),
    changeNote: text("change_note"),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    createdByKind: text("created_by_kind").notNull().default("user"),
    createdById: text("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUq: uniqueIndex("erp_revisions_code_uq").on(
      table.companyId,
      table.documentId,
      table.revisionCode,
    ),
    ordinalUq: uniqueIndex("erp_revisions_ordinal_uq").on(
      table.companyId,
      table.documentId,
      table.revisionOrdinal,
    ),
    companyDocumentIdx: index("erp_revisions_company_document_idx").on(
      table.companyId,
      table.documentId,
      table.revisionOrdinal,
    ),
    companyStateIdx: index("erp_revisions_company_state_idx").on(
      table.companyId,
      table.reviewState,
    ),
    companyAssetIdx: index("erp_revisions_company_asset_idx").on(table.companyId, table.assetId),
    stateCk: check(
      "erp_revisions_state_ck",
      sql`${table.reviewState} in ('DRAFT', 'AI_GENERATED', 'REQUIRES_REVIEW', 'APPROVED', 'RELEASED', 'REJECTED')`,
    ),
    byteSizeCk: check("erp_revisions_byte_size_ck", sql`${table.assetByteSize} >= 0`),
  }),
);

/**
 * One extraction attempt over one revision. The header that every extracted
 * value hangs off, so provenance survives even if the values are superseded.
 */
export const erpExtractionRuns = pgTable(
  "erp_extraction_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => erpDocuments.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => erpDocumentRevisions.id, { onDelete: "cascade" }),
    extractionMethod: text("extraction_method").notNull(),
    extractionTool: text("extraction_tool"),
    modelId: text("model_id"),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    /** Checksum of the bytes actually read, so a value is traceable to real content. */
    sourceSha256: text("source_sha256").notNull(),
    status: text("status").notNull().default("started"),
    valueCount: integer("value_count").notNull().default(0),
    warnings: jsonb("warnings").$type<unknown[]>().notNull().default([]),
    idempotencyKey: text("idempotency_key").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (table) => ({
    idempotencyUq: uniqueIndex("erp_extraction_runs_idem_uq").on(
      table.companyId,
      table.idempotencyKey,
    ),
    companyRevisionIdx: index("erp_extraction_runs_company_revision_idx").on(
      table.companyId,
      table.revisionId,
      table.startedAt,
    ),
    companyStatusIdx: index("erp_extraction_runs_company_status_idx").on(
      table.companyId,
      table.status,
      table.startedAt,
    ),
    methodCk: check(
      "erp_extraction_runs_method_ck",
      sql`${table.extractionMethod} in ('llm_vision', 'llm_text', 'ocr', 'parser', 'manual')`,
    ),
    statusCk: check(
      "erp_extraction_runs_status_ck",
      sql`${table.status} in ('started', 'committed', 'failed', 'abandoned')`,
    ),
  }),
);

/**
 * The provenance table. Every engineering value records where it came from:
 * document, revision, page, locator, method, model and confidence.
 *
 * `origin = 'ai'` with `reviewState = 'unreviewed'` is the only state an agent
 * can write. Nothing here is engineering record until a human says so.
 */
export const erpExtractedValues = pgTable(
  "erp_extracted_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => erpDocuments.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => erpDocumentRevisions.id, { onDelete: "cascade" }),
    extractionRunId: uuid("extraction_run_id")
      .notNull()
      .references(() => erpExtractionRuns.id, { onDelete: "cascade" }),
    /** Equipment tag exactly as printed, e.g. `FV-1042`. */
    tag: text("tag").notNull(),
    attribute: text("attribute").notNull(),
    valueText: text("value_text").notNull(),
    valueNumeric: numeric("value_numeric"),
    unit: text("unit"),
    pageNo: integer("page_no"),
    locator: jsonb("locator").$type<Record<string, unknown>>().notNull().default({}),
    confidence: numeric("confidence"),
    origin: text("origin").notNull(),
    reviewState: text("review_state").notNull().default("unreviewed"),
    correctedValueText: text("corrected_value_text"),
    correctedUnit: text("corrected_unit"),
    reviewNote: text("review_note"),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runKeyUq: uniqueIndex("erp_values_run_key_uq").on(
      table.companyId,
      table.extractionRunId,
      table.tag,
      table.attribute,
    ),
    /** Backs the "where did this value come from?" lookup. */
    tagLookupIdx: index("erp_values_tag_lookup_idx").on(
      table.companyId,
      table.tag,
      table.attribute,
      table.extractedAt,
    ),
    companyRevisionIdx: index("erp_values_company_revision_idx").on(
      table.companyId,
      table.revisionId,
    ),
    companyReviewIdx: index("erp_values_company_review_idx").on(
      table.companyId,
      table.reviewState,
    ),
    originCk: check("erp_values_origin_ck", sql`${table.origin} in ('ai', 'human', 'parser')`),
    reviewCk: check(
      "erp_values_review_ck",
      sql`${table.reviewState} in ('unreviewed', 'accepted', 'corrected', 'rejected')`,
    ),
    confidenceCk: check(
      "erp_values_confidence_ck",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
  }),
);

/**
 * A cached deterministic comparison between two revisions.
 *
 * `summaryText` and the entry rows are computed in TypeScript. `narrativeText`
 * is optional commentary an agent may attach afterwards; it can never alter the
 * counts or entries.
 */
export const erpRevisionDiffs = pgTable(
  "erp_revision_diffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => erpDocuments.id, { onDelete: "cascade" }),
    fromRevisionId: uuid("from_revision_id")
      .notNull()
      .references(() => erpDocumentRevisions.id, { onDelete: "cascade" }),
    toRevisionId: uuid("to_revision_id")
      .notNull()
      .references(() => erpDocumentRevisions.id, { onDelete: "cascade" }),
    algorithmVersion: integer("algorithm_version").notNull(),
    /** sha256 of the canonicalised inputs, so a stale cache entry is detectable. */
    inputFingerprint: text("input_fingerprint").notNull(),
    addedCount: integer("added_count").notNull().default(0),
    removedCount: integer("removed_count").notNull().default(0),
    changedCount: integer("changed_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    summaryText: text("summary_text").notNull().default(""),
    narrativeText: text("narrative_text"),
    narrativeOrigin: text("narrative_origin"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pairUq: uniqueIndex("erp_diffs_pair_uq").on(
      table.companyId,
      table.fromRevisionId,
      table.toRevisionId,
      table.algorithmVersion,
    ),
    companyDocumentIdx: index("erp_diffs_company_document_idx").on(
      table.companyId,
      table.documentId,
      table.computedAt,
    ),
  }),
);

export const erpRevisionDiffEntries = pgTable(
  "erp_revision_diff_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    diffId: uuid("diff_id")
      .notNull()
      .references(() => erpRevisionDiffs.id, { onDelete: "cascade" }),
    changeKind: text("change_kind").notNull(),
    tag: text("tag").notNull(),
    attribute: text("attribute").notNull(),
    fromValueText: text("from_value_text"),
    toValueText: text("to_value_text"),
    fromUnit: text("from_unit"),
    toUnit: text("to_unit"),
    /** Null when the two sides use different units - the ERP never converts. */
    numericDelta: numeric("numeric_delta"),
    unitChanged: boolean("unit_changed").notNull().default(false),
  },
  (table) => ({
    companyDiffIdx: index("erp_diff_entries_company_diff_idx").on(
      table.companyId,
      table.diffId,
      table.changeKind,
    ),
    kindCk: check(
      "erp_diff_entries_kind_ck",
      sql`${table.changeKind} in ('added', 'removed', 'changed')`,
    ),
  }),
);

/** Append-only record of every review-state change. Never updated, never deleted. */
export const erpStateTransitions = pgTable(
  "erp_state_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => erpDocuments.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => erpDocumentRevisions.id, { onDelete: "cascade" }),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    note: text("note"),
    operationId: text("operation_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    operationUq: uniqueIndex("erp_transitions_operation_uq").on(
      table.companyId,
      table.operationId,
    ),
    companyRevisionIdx: index("erp_transitions_company_revision_idx").on(
      table.companyId,
      table.revisionId,
      table.occurredAt,
    ),
    actorKindCk: check(
      "erp_transitions_actor_kind_ck",
      sql`${table.actorKind} in ('user', 'agent', 'plugin')`,
    ),
  }),
);

/**
 * Bridges an ERP release to a core approval, so a released document is always
 * traceable to a human decision.
 *
 * The identifier is `gateRef`, not `gateToken`: core redacts any approval
 * payload key matching token/secret/key/auth on every approvals response, so a
 * token-named field would come back unreadable and break the link step.
 */
export const erpReleaseGates = pgTable(
  "erp_release_gates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => erpDocuments.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => erpDocumentRevisions.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    gateRef: text("gate_ref").notNull(),
    gateStatus: text("gate_status").notNull().default("awaiting_link"),
    decidedByUserId: text("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    refUq: uniqueIndex("erp_gates_ref_uq").on(table.companyId, table.gateRef),
    approvalUq: uniqueIndex("erp_gates_approval_uq").on(table.companyId, table.approvalId),
    companyStatusIdx: index("erp_gates_company_status_idx").on(
      table.companyId,
      table.gateStatus,
      table.updatedAt,
    ),
    statusCk: check(
      "erp_gates_status_ck",
      sql`${table.gateStatus} in ('awaiting_link', 'pending', 'approved', 'rejected', 'cancelled')`,
    ),
  }),
);

/**
 * The ERP's own resource permissions.
 *
 * Core `PERMISSION_KEYS` is a closed set covering organisational administration
 * and does not model documents or engineering values, so the ERP owns this
 * layer. Grants are optionally scoped to a project.
 */
export const erpRoleGrants = pgTable(
  "erp_role_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    principalKind: text("principal_kind").notNull(),
    principalId: text("principal_id").notNull(),
    erpRole: text("erp_role").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    grantedByUserId: text("granted_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lookupIdx: index("erp_role_grants_lookup_idx").on(
      table.companyId,
      table.principalKind,
      table.principalId,
    ),
    companyRoleIdx: index("erp_role_grants_company_role_idx").on(table.companyId, table.erpRole),
    principalKindCk: check(
      "erp_role_grants_principal_kind_ck",
      sql`${table.principalKind} in ('user', 'agent')`,
    ),
    roleCk: check(
      "erp_role_grants_role_ck",
      sql`${table.erpRole} in ('erp_viewer', 'erp_engineer', 'erp_doc_controller', 'erp_approver', 'erp_admin')`,
    ),
  }),
);

/**
 * Idempotency ledger. A caller-supplied key makes a retried operation safe:
 * the stored result is returned instead of the work being redone.
 */
export const erpOperations = pgTable(
  "erp_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    operationKind: text("operation_kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("started"),
    requestFingerprint: text("request_fingerprint"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => ({
    idempotencyUq: uniqueIndex("erp_operations_idem_uq").on(
      table.companyId,
      table.operationKind,
      table.idempotencyKey,
    ),
    sweepIdx: index("erp_operations_sweep_idx").on(
      table.companyId,
      table.status,
      table.startedAt,
    ),
    statusCk: check(
      "erp_operations_status_ck",
      sql`${table.status} in ('started', 'committed', 'failed', 'abandoned')`,
    ),
  }),
);
