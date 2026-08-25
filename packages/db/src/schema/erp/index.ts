/**
 * Industrial ERP schema.
 *
 * Kept in its own directory so the ERP's tables are visibly separate from the
 * control plane's, while still sharing one drizzle-kit configuration and one
 * migration timeline. Every table name is prefixed `erp_`.
 */
export {
  erpDocuments,
  erpDocumentRevisions,
  erpExtractionRuns,
  erpExtractedValues,
  erpRevisionDiffs,
  erpRevisionDiffEntries,
  erpStateTransitions,
  erpReleaseGates,
  erpRoleGrants,
  erpOperations,
} from "./erp_documents.js";
