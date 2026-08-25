/**
 * Shared ERP vocabulary.
 *
 * These are the closed sets the whole ERP agrees on. They live in the domain
 * layer because both the persistence layer and the HTTP layer must not disagree
 * about them.
 */
/**
 * Lifecycle states shared by document revisions and extracted values.
 *
 * Anything an agent writes enters as `AI_GENERATED`. Only a human actor holding
 * the release grant can reach `APPROVED` or `RELEASED`; see `src/erp/lifecycle.ts`.
 */
export const ERP_REVIEW_STATES = [
  "DRAFT",
  "AI_GENERATED",
  "REQUIRES_REVIEW",
  "APPROVED",
  "RELEASED",
  "REJECTED",
] as const;
export type ErpReviewState = (typeof ERP_REVIEW_STATES)[number];

/** Roles in the ERP's own permission layer. Core PERMISSION_KEYS does not model ERP resources. */
export const ERP_ROLES = [
  "erp_viewer",
  "erp_engineer",
  "erp_doc_controller",
  "erp_approver",
  "erp_admin",
] as const;
export type ErpRole = (typeof ERP_ROLES)[number];

/** Where an extracted value came from. `ai` values are never trusted as engineering record. */
export const ERP_VALUE_ORIGINS = ["ai", "human", "parser"] as const;
export type ErpValueOrigin = (typeof ERP_VALUE_ORIGINS)[number];

/** Review outcome for a single extracted value. */
export const ERP_VALUE_REVIEW_STATES = ["unreviewed", "accepted", "corrected", "rejected"] as const;
export type ErpValueReviewState = (typeof ERP_VALUE_REVIEW_STATES)[number];

/**
 * Bumped whenever `diffRevisionValues` changes in a way that alters output for
 * the same input. Persisted on every cached diff so stale rows are detectable.
 */
export const DIFF_ALGORITHM_VERSION = 1;
