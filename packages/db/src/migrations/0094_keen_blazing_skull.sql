CREATE TABLE "erp_document_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_code" text NOT NULL,
	"revision_ordinal" integer NOT NULL,
	"review_state" text DEFAULT 'DRAFT' NOT NULL,
	"supersedes_revision_id" uuid,
	"asset_id" uuid NOT NULL,
	"asset_sha256" text NOT NULL,
	"asset_byte_size" bigint NOT NULL,
	"asset_content_type" text NOT NULL,
	"asset_filename" text,
	"asset_verified_at" timestamp with time zone,
	"asset_verified_sha256" text,
	"page_count" integer,
	"change_note" text,
	"approval_id" uuid,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_number" text NOT NULL,
	"title" text NOT NULL,
	"doc_type" text NOT NULL,
	"discipline" text,
	"project_id" uuid,
	"party_ref" text,
	"lifecycle_status" text DEFAULT 'active' NOT NULL,
	"current_revision_id" uuid,
	"released_revision_id" uuid,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_extracted_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"attribute" text NOT NULL,
	"value_text" text NOT NULL,
	"value_numeric" numeric,
	"unit" text,
	"page_no" integer,
	"locator" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" numeric,
	"origin" text NOT NULL,
	"review_state" text DEFAULT 'unreviewed' NOT NULL,
	"corrected_value_text" text,
	"corrected_unit" text,
	"review_note" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"extraction_method" text NOT NULL,
	"extraction_tool" text,
	"model_id" text,
	"agent_id" uuid,
	"run_id" uuid,
	"issue_id" uuid,
	"source_sha256" text NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"value_count" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"operation_kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"request_fingerprint" text,
	"result" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_release_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"approval_id" uuid,
	"gate_ref" text NOT NULL,
	"gate_status" text DEFAULT 'awaiting_link' NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_revision_diff_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"diff_id" uuid NOT NULL,
	"change_kind" text NOT NULL,
	"tag" text NOT NULL,
	"attribute" text NOT NULL,
	"from_value_text" text,
	"to_value_text" text,
	"from_unit" text,
	"to_unit" text,
	"numeric_delta" numeric,
	"unit_changed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_revision_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"from_revision_id" uuid NOT NULL,
	"to_revision_id" uuid NOT NULL,
	"algorithm_version" integer NOT NULL,
	"input_fingerprint" text NOT NULL,
	"added_count" integer DEFAULT 0 NOT NULL,
	"removed_count" integer DEFAULT 0 NOT NULL,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"summary_text" text DEFAULT '' NOT NULL,
	"narrative_text" text,
	"narrative_origin" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"principal_kind" text NOT NULL,
	"principal_id" text NOT NULL,
	"erp_role" text NOT NULL,
	"project_id" uuid,
	"granted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp_state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"agent_id" uuid,
	"run_id" uuid,
	"approval_id" uuid,
	"note" text,
	"operation_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "erp_document_revisions" ADD CONSTRAINT "erp_document_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_document_revisions" ADD CONSTRAINT "erp_document_revisions_document_id_erp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."erp_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_document_revisions" ADD CONSTRAINT "erp_document_revisions_supersedes_revision_id_erp_document_revisions_id_fk" FOREIGN KEY ("supersedes_revision_id") REFERENCES "public"."erp_document_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_document_revisions" ADD CONSTRAINT "erp_document_revisions_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_documents" ADD CONSTRAINT "erp_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_documents" ADD CONSTRAINT "erp_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extracted_values" ADD CONSTRAINT "erp_extracted_values_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extracted_values" ADD CONSTRAINT "erp_extracted_values_document_id_erp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."erp_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extracted_values" ADD CONSTRAINT "erp_extracted_values_revision_id_erp_document_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."erp_document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extracted_values" ADD CONSTRAINT "erp_extracted_values_extraction_run_id_erp_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."erp_extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extraction_runs" ADD CONSTRAINT "erp_extraction_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extraction_runs" ADD CONSTRAINT "erp_extraction_runs_document_id_erp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."erp_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extraction_runs" ADD CONSTRAINT "erp_extraction_runs_revision_id_erp_document_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."erp_document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extraction_runs" ADD CONSTRAINT "erp_extraction_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extraction_runs" ADD CONSTRAINT "erp_extraction_runs_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_extraction_runs" ADD CONSTRAINT "erp_extraction_runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_operations" ADD CONSTRAINT "erp_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_release_gates" ADD CONSTRAINT "erp_release_gates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_release_gates" ADD CONSTRAINT "erp_release_gates_document_id_erp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."erp_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_release_gates" ADD CONSTRAINT "erp_release_gates_revision_id_erp_document_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."erp_document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_release_gates" ADD CONSTRAINT "erp_release_gates_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_revision_diff_entries" ADD CONSTRAINT "erp_revision_diff_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_revision_diff_entries" ADD CONSTRAINT "erp_revision_diff_entries_diff_id_erp_revision_diffs_id_fk" FOREIGN KEY ("diff_id") REFERENCES "public"."erp_revision_diffs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_revision_diffs" ADD CONSTRAINT "erp_revision_diffs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_revision_diffs" ADD CONSTRAINT "erp_revision_diffs_document_id_erp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."erp_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_revision_diffs" ADD CONSTRAINT "erp_revision_diffs_from_revision_id_erp_document_revisions_id_fk" FOREIGN KEY ("from_revision_id") REFERENCES "public"."erp_document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_revision_diffs" ADD CONSTRAINT "erp_revision_diffs_to_revision_id_erp_document_revisions_id_fk" FOREIGN KEY ("to_revision_id") REFERENCES "public"."erp_document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_role_grants" ADD CONSTRAINT "erp_role_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_role_grants" ADD CONSTRAINT "erp_role_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_state_transitions" ADD CONSTRAINT "erp_state_transitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_state_transitions" ADD CONSTRAINT "erp_state_transitions_document_id_erp_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."erp_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_state_transitions" ADD CONSTRAINT "erp_state_transitions_revision_id_erp_document_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."erp_document_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_state_transitions" ADD CONSTRAINT "erp_state_transitions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_state_transitions" ADD CONSTRAINT "erp_state_transitions_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_state_transitions" ADD CONSTRAINT "erp_state_transitions_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erp_revisions_code_uq" ON "erp_document_revisions" USING btree ("company_id","document_id","revision_code");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_revisions_ordinal_uq" ON "erp_document_revisions" USING btree ("company_id","document_id","revision_ordinal");--> statement-breakpoint
CREATE INDEX "erp_revisions_company_document_idx" ON "erp_document_revisions" USING btree ("company_id","document_id","revision_ordinal");--> statement-breakpoint
CREATE INDEX "erp_revisions_company_state_idx" ON "erp_document_revisions" USING btree ("company_id","review_state");--> statement-breakpoint
CREATE INDEX "erp_revisions_company_asset_idx" ON "erp_document_revisions" USING btree ("company_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_documents_number_uq" ON "erp_documents" USING btree ("company_id","doc_number");--> statement-breakpoint
CREATE INDEX "erp_documents_company_updated_idx" ON "erp_documents" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE INDEX "erp_documents_company_project_idx" ON "erp_documents" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "erp_documents_company_type_idx" ON "erp_documents" USING btree ("company_id","doc_type");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_values_run_key_uq" ON "erp_extracted_values" USING btree ("company_id","extraction_run_id","tag","attribute");--> statement-breakpoint
CREATE INDEX "erp_values_tag_lookup_idx" ON "erp_extracted_values" USING btree ("company_id","tag","attribute","extracted_at");--> statement-breakpoint
CREATE INDEX "erp_values_company_revision_idx" ON "erp_extracted_values" USING btree ("company_id","revision_id");--> statement-breakpoint
CREATE INDEX "erp_values_company_review_idx" ON "erp_extracted_values" USING btree ("company_id","review_state");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_extraction_runs_idem_uq" ON "erp_extraction_runs" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "erp_extraction_runs_company_revision_idx" ON "erp_extraction_runs" USING btree ("company_id","revision_id","started_at");--> statement-breakpoint
CREATE INDEX "erp_extraction_runs_company_status_idx" ON "erp_extraction_runs" USING btree ("company_id","status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_operations_idem_uq" ON "erp_operations" USING btree ("company_id","operation_kind","idempotency_key");--> statement-breakpoint
CREATE INDEX "erp_operations_sweep_idx" ON "erp_operations" USING btree ("company_id","status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_gates_ref_uq" ON "erp_release_gates" USING btree ("company_id","gate_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_gates_approval_uq" ON "erp_release_gates" USING btree ("company_id","approval_id");--> statement-breakpoint
CREATE INDEX "erp_gates_company_status_idx" ON "erp_release_gates" USING btree ("company_id","gate_status","updated_at");--> statement-breakpoint
CREATE INDEX "erp_diff_entries_company_diff_idx" ON "erp_revision_diff_entries" USING btree ("company_id","diff_id","change_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_diffs_pair_uq" ON "erp_revision_diffs" USING btree ("company_id","from_revision_id","to_revision_id","algorithm_version");--> statement-breakpoint
CREATE INDEX "erp_diffs_company_document_idx" ON "erp_revision_diffs" USING btree ("company_id","document_id","computed_at");--> statement-breakpoint
CREATE INDEX "erp_role_grants_lookup_idx" ON "erp_role_grants" USING btree ("company_id","principal_kind","principal_id");--> statement-breakpoint
CREATE INDEX "erp_role_grants_company_role_idx" ON "erp_role_grants" USING btree ("company_id","erp_role");--> statement-breakpoint
CREATE UNIQUE INDEX "erp_transitions_operation_uq" ON "erp_state_transitions" USING btree ("company_id","operation_id");--> statement-breakpoint
CREATE INDEX "erp_transitions_company_revision_idx" ON "erp_state_transitions" USING btree ("company_id","revision_id","occurred_at");