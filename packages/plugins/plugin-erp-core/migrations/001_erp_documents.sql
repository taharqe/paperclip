-- Industrial ERP core - document control and engineering data provenance.
--
-- Namespace is hardcoded because the host does not substitute it; see
-- src/constants.ts and tests/namespace.spec.ts.
--
-- Constraints imposed by the plugin migration validator (server/src/services/
-- plugin-database.ts): additive only - no DROP, no TRUNCATE, no extensions, no
-- triggers, no functions. Foreign keys into public.* are limited to the tables
-- whitelisted in the manifest coreReadTables list.
--
-- Deliberate omission: revision rows carry `asset_id` WITHOUT a foreign key to
-- public.assets. Core deletes asset rows in several paths (replacing a company
-- logo, replacing an attachment, deleting a company). ON DELETE CASCADE would
-- let one of those silently destroy a document-control record; RESTRICT would
-- break company deletion, which deletes assets before the company row. A
-- document-control audit record must outlive its blob, so the checksum, size,
-- content type and filename are denormalised here instead.

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_documents (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  doc_number text NOT NULL,
  title text NOT NULL,
  doc_type text NOT NULL,
  discipline text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  party_ref text,
  lifecycle_status text NOT NULL DEFAULT 'active',
  current_revision_id uuid,
  released_revision_id uuid,
  created_by_kind text NOT NULL DEFAULT 'user',
  created_by_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_documents_number_uq UNIQUE (company_id, doc_number),
  CONSTRAINT erp_documents_lifecycle_ck CHECK (lifecycle_status IN ('active', 'superseded', 'withdrawn')),
  CONSTRAINT erp_documents_created_by_kind_ck CHECK (created_by_kind IN ('user', 'agent', 'plugin'))
);

CREATE INDEX IF NOT EXISTS erp_documents_company_updated_idx
  ON plugin_erp_core_b9375856a1.erp_documents (company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS erp_documents_company_project_idx
  ON plugin_erp_core_b9375856a1.erp_documents (company_id, project_id);
CREATE INDEX IF NOT EXISTS erp_documents_company_type_idx
  ON plugin_erp_core_b9375856a1.erp_documents (company_id, doc_type);

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_document_revisions (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_documents(id) ON DELETE CASCADE,
  revision_code text NOT NULL,
  revision_ordinal integer NOT NULL,
  review_state text NOT NULL DEFAULT 'DRAFT',
  supersedes_revision_id uuid,
  asset_id uuid NOT NULL,
  asset_sha256 text NOT NULL,
  asset_byte_size bigint NOT NULL,
  asset_content_type text NOT NULL,
  asset_filename text,
  asset_verified_at timestamptz,
  asset_verified_sha256 text,
  page_count integer,
  change_note text,
  approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL,
  created_by_kind text NOT NULL DEFAULT 'user',
  created_by_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_revisions_code_uq UNIQUE (company_id, document_id, revision_code),
  CONSTRAINT erp_revisions_ordinal_uq UNIQUE (company_id, document_id, revision_ordinal),
  CONSTRAINT erp_revisions_state_ck CHECK (review_state IN ('DRAFT', 'AI_GENERATED', 'REQUIRES_REVIEW', 'APPROVED', 'RELEASED', 'REJECTED')),
  CONSTRAINT erp_revisions_byte_size_ck CHECK (asset_byte_size >= 0)
);

CREATE INDEX IF NOT EXISTS erp_revisions_company_document_idx
  ON plugin_erp_core_b9375856a1.erp_document_revisions (company_id, document_id, revision_ordinal DESC);
CREATE INDEX IF NOT EXISTS erp_revisions_company_state_idx
  ON plugin_erp_core_b9375856a1.erp_document_revisions (company_id, review_state);
CREATE INDEX IF NOT EXISTS erp_revisions_company_asset_idx
  ON plugin_erp_core_b9375856a1.erp_document_revisions (company_id, asset_id);

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_extraction_runs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_documents(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_document_revisions(id) ON DELETE CASCADE,
  extraction_method text NOT NULL,
  extraction_tool text,
  model_id text,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  run_id uuid REFERENCES public.heartbeat_runs(id) ON DELETE SET NULL,
  issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  source_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  value_count integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  CONSTRAINT erp_extraction_runs_idem_uq UNIQUE (company_id, idempotency_key),
  CONSTRAINT erp_extraction_runs_method_ck CHECK (extraction_method IN ('llm_vision', 'llm_text', 'ocr', 'parser', 'manual')),
  CONSTRAINT erp_extraction_runs_status_ck CHECK (status IN ('started', 'committed', 'failed', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS erp_extraction_runs_company_revision_idx
  ON plugin_erp_core_b9375856a1.erp_extraction_runs (company_id, revision_id, started_at DESC);
CREATE INDEX IF NOT EXISTS erp_extraction_runs_company_status_idx
  ON plugin_erp_core_b9375856a1.erp_extraction_runs (company_id, status, started_at);

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_extracted_values (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_documents(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_document_revisions(id) ON DELETE CASCADE,
  extraction_run_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_extraction_runs(id) ON DELETE CASCADE,
  tag text NOT NULL,
  attribute text NOT NULL,
  value_text text NOT NULL,
  value_numeric numeric,
  unit text,
  page_no integer,
  locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  origin text NOT NULL,
  review_state text NOT NULL DEFAULT 'unreviewed',
  corrected_value_text text,
  corrected_unit text,
  review_note text,
  reviewed_by_user_id text,
  reviewed_at timestamptz,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_values_run_key_uq UNIQUE (company_id, extraction_run_id, tag, attribute),
  CONSTRAINT erp_values_origin_ck CHECK (origin IN ('ai', 'human', 'parser')),
  CONSTRAINT erp_values_review_ck CHECK (review_state IN ('unreviewed', 'accepted', 'corrected', 'rejected')),
  CONSTRAINT erp_values_confidence_ck CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS erp_values_tag_lookup_idx
  ON plugin_erp_core_b9375856a1.erp_extracted_values (company_id, tag, attribute, extracted_at DESC);
CREATE INDEX IF NOT EXISTS erp_values_company_revision_idx
  ON plugin_erp_core_b9375856a1.erp_extracted_values (company_id, revision_id);
CREATE INDEX IF NOT EXISTS erp_values_company_review_idx
  ON plugin_erp_core_b9375856a1.erp_extracted_values (company_id, review_state);

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_revision_diffs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_documents(id) ON DELETE CASCADE,
  from_revision_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_document_revisions(id) ON DELETE CASCADE,
  to_revision_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_document_revisions(id) ON DELETE CASCADE,
  algorithm_version integer NOT NULL,
  input_fingerprint text NOT NULL,
  added_count integer NOT NULL DEFAULT 0,
  removed_count integer NOT NULL DEFAULT 0,
  changed_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  summary_text text NOT NULL DEFAULT '',
  narrative_text text,
  narrative_origin text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_diffs_pair_uq UNIQUE (company_id, from_revision_id, to_revision_id, algorithm_version)
);

CREATE INDEX IF NOT EXISTS erp_diffs_company_document_idx
  ON plugin_erp_core_b9375856a1.erp_revision_diffs (company_id, document_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_revision_diff_entries (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  diff_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_revision_diffs(id) ON DELETE CASCADE,
  change_kind text NOT NULL,
  tag text NOT NULL,
  attribute text NOT NULL,
  from_value_text text,
  to_value_text text,
  from_unit text,
  to_unit text,
  numeric_delta numeric,
  unit_changed boolean NOT NULL DEFAULT false,
  CONSTRAINT erp_diff_entries_kind_ck CHECK (change_kind IN ('added', 'removed', 'changed'))
);

CREATE INDEX IF NOT EXISTS erp_diff_entries_company_diff_idx
  ON plugin_erp_core_b9375856a1.erp_revision_diff_entries (company_id, diff_id, change_kind);

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_state_transitions (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_documents(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_document_revisions(id) ON DELETE CASCADE,
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  run_id uuid REFERENCES public.heartbeat_runs(id) ON DELETE SET NULL,
  approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL,
  note text,
  operation_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_transitions_operation_uq UNIQUE (company_id, operation_id),
  CONSTRAINT erp_transitions_actor_kind_ck CHECK (actor_kind IN ('user', 'agent', 'plugin'))
);

CREATE INDEX IF NOT EXISTS erp_transitions_company_revision_idx
  ON plugin_erp_core_b9375856a1.erp_state_transitions (company_id, revision_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_release_gates (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_documents(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES plugin_erp_core_b9375856a1.erp_document_revisions(id) ON DELETE CASCADE,
  approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL,
  gate_ref text NOT NULL,
  gate_status text NOT NULL DEFAULT 'awaiting_link',
  decided_by_user_id text,
  decided_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_gates_ref_uq UNIQUE (company_id, gate_ref),
  CONSTRAINT erp_gates_approval_uq UNIQUE (company_id, approval_id),
  CONSTRAINT erp_gates_status_ck CHECK (gate_status IN ('awaiting_link', 'pending', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS erp_gates_company_status_idx
  ON plugin_erp_core_b9375856a1.erp_release_gates (company_id, gate_status, updated_at);

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_role_grants (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  erp_role text NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  granted_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_role_grants_principal_kind_ck CHECK (principal_kind IN ('user', 'agent')),
  CONSTRAINT erp_role_grants_role_ck CHECK (erp_role IN ('erp_viewer', 'erp_engineer', 'erp_doc_controller', 'erp_approver', 'erp_admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_role_grants_scoped_uq
  ON plugin_erp_core_b9375856a1.erp_role_grants (company_id, principal_kind, principal_id, erp_role, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS erp_role_grants_lookup_idx
  ON plugin_erp_core_b9375856a1.erp_role_grants (company_id, principal_kind, principal_id);

CREATE TABLE IF NOT EXISTS plugin_erp_core_b9375856a1.erp_operations (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  operation_kind text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  request_fingerprint text,
  result jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT erp_operations_idem_uq UNIQUE (company_id, operation_kind, idempotency_key),
  CONSTRAINT erp_operations_status_ck CHECK (status IN ('started', 'committed', 'failed', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS erp_operations_sweep_idx
  ON plugin_erp_core_b9375856a1.erp_operations (company_id, status, started_at);
