import { ERP_NAMESPACE as NS } from "../constants.js";

/**
 * Every SQL statement the worker runs, as a named constant.
 *
 * They live together so `tests/sql.spec.ts` can push all of them through the
 * host's real validators. An illegal statement then fails as a test rather than
 * as a 500 in production.
 *
 * The host's runtime rules (server/src/services/plugin-database.ts):
 *
 *  - `query`   : exactly one statement, starts `select ` or `with `, contains no
 *                mutation or DDL keyword anywhere, may read this namespace plus
 *                the whitelisted public tables.
 *  - `execute` : exactly one statement, starts `insert into` / `update` /
 *                `delete from`, and may not reference `public` **at all**.
 *
 * That last rule is why the schema denormalises `company_id` into every table:
 * a write can never join core to discover it.
 */

/* ------------------------------------------------------------------ reads */

export const SELECT_GRANTS_FOR_PRINCIPAL = `
select erp_role, project_id
  from ${NS}.erp_role_grants
 where company_id = $1
   and principal_kind = $2
   and principal_id = $3
`;

export const SELECT_DOCUMENTS = `
select d.id,
       d.doc_number,
       d.title,
       d.doc_type,
       d.discipline,
       d.project_id,
       d.party_ref,
       d.lifecycle_status,
       d.current_revision_id,
       d.released_revision_id,
       d.updated_at,
       p.name as project_name
  from ${NS}.erp_documents d
  left join public.projects p on p.id = d.project_id
 where d.company_id = $1
   and ($2::uuid is null or d.project_id = $2::uuid)
   and ($3::text is null or d.doc_type = $3::text)
 order by d.updated_at desc
 limit $4 offset $5
`;

export const SELECT_DOCUMENT_BY_ID = `
select d.id,
       d.company_id,
       d.doc_number,
       d.title,
       d.doc_type,
       d.discipline,
       d.project_id,
       d.party_ref,
       d.lifecycle_status,
       d.current_revision_id,
       d.released_revision_id,
       d.created_at,
       d.updated_at
  from ${NS}.erp_documents d
 where d.company_id = $1
   and d.id = $2
`;

export const SELECT_REVISIONS_FOR_DOCUMENT = `
select r.id,
       r.revision_code,
       r.revision_ordinal,
       r.review_state,
       r.asset_id,
       r.asset_sha256,
       r.asset_byte_size,
       r.asset_content_type,
       r.asset_filename,
       r.asset_verified_at,
       r.approval_id,
       r.change_note,
       r.created_at,
       a.sha256 as core_asset_sha256,
       a.byte_size as core_asset_byte_size
  from ${NS}.erp_document_revisions r
  left join public.assets a on a.id = r.asset_id
 where r.company_id = $1
   and r.document_id = $2
 order by r.revision_ordinal desc
`;

/**
 * The "where did this value come from?" query.
 *
 * Joins the value to its revision, document and extraction run so a single
 * round trip returns the whole provenance chain.
 */
export const SELECT_PROVENANCE_BY_TAG = `
select v.id as value_id,
       v.tag,
       v.attribute,
       v.value_text,
       v.value_numeric,
       v.unit,
       v.page_no,
       v.locator,
       v.confidence,
       v.origin,
       v.review_state,
       v.reviewed_by_user_id,
       v.reviewed_at,
       v.extracted_at,
       d.id as document_id,
       d.doc_number,
       d.title as document_title,
       r.id as revision_id,
       r.revision_code,
       r.review_state as revision_state,
       r.asset_id,
       r.asset_sha256,
       x.extraction_method,
       x.model_id,
       x.agent_id,
       x.run_id
  from ${NS}.erp_extracted_values v
  join ${NS}.erp_document_revisions r on r.id = v.revision_id
  join ${NS}.erp_documents d on d.id = v.document_id
  join ${NS}.erp_extraction_runs x on x.id = v.extraction_run_id
 where v.company_id = $1
   and ($2::text is null or v.tag = $2::text)
   and ($3::text is null or v.attribute = $3::text)
   and ($4::uuid is null or v.id = $4::uuid)
   and ($5::uuid is null or v.revision_id = $5::uuid)
 order by v.extracted_at desc
 limit $6
`;

export const SELECT_VALUES_FOR_REVISION = `
select v.id as value_id,
       v.tag,
       v.attribute,
       v.value_text,
       v.value_numeric,
       v.unit
  from ${NS}.erp_extracted_values v
 where v.company_id = $1
   and v.revision_id = $2
   and v.review_state <> 'rejected'
 order by v.tag, v.attribute
`;

export const SELECT_REVIEW_QUEUE = `
select r.id as revision_id,
       r.revision_code,
       r.review_state,
       d.id as document_id,
       d.doc_number,
       d.title,
       d.project_id,
       count(v.id) filter (where v.review_state = 'unreviewed') as unreviewed_values,
       r.updated_at
  from ${NS}.erp_document_revisions r
  join ${NS}.erp_documents d on d.id = r.document_id
  left join ${NS}.erp_extracted_values v on v.revision_id = r.id
 where r.company_id = $1
   and r.review_state = any($2::text[])
 group by r.id, r.revision_code, r.review_state, d.id, d.doc_number, d.title, d.project_id, r.updated_at
 order by r.updated_at asc
 limit $3
`;

export const SELECT_RELEASE_GATE_FOR_REVISION = `
select g.id,
       g.gate_ref,
       g.gate_status,
       g.approval_id,
       g.decided_by_user_id,
       g.decided_at,
       ap.status as approval_status,
       ap.decided_by_user_id as approval_decided_by
  from ${NS}.erp_release_gates g
  left join public.approvals ap on ap.id = g.approval_id
 where g.company_id = $1
   and g.revision_id = $2
 order by g.created_at desc
 limit 1
`;

export const SELECT_OPERATION = `
select id, status, result
  from ${NS}.erp_operations
 where company_id = $1
   and operation_kind = $2
   and idempotency_key = $3
`;

export const SELECT_REVISION_STATE = `
select r.id, r.company_id, r.document_id, r.review_state, r.asset_sha256, d.project_id
  from ${NS}.erp_document_revisions r
  join ${NS}.erp_documents d on d.id = r.document_id
 where r.company_id = $1
   and r.id = $2
`;

/* ----------------------------------------------------------------- writes */

export const INSERT_OPERATION = `
insert into ${NS}.erp_operations (id, company_id, operation_kind, idempotency_key, status, request_fingerprint)
values ($1, $2, $3, $4, 'started', $5)
on conflict (company_id, operation_kind, idempotency_key) do nothing
`;

export const SETTLE_OPERATION = `
update ${NS}.erp_operations
   set status = $4, result = $5, settled_at = now()
 where company_id = $1
   and operation_kind = $2
   and idempotency_key = $3
`;

export const ABANDON_STALE_OPERATIONS = `
update ${NS}.erp_operations
   set status = 'abandoned', settled_at = now()
 where company_id = $1
   and status = 'started'
   and started_at < now() - interval '15 minutes'
`;

export const INSERT_DOCUMENT = `
insert into ${NS}.erp_documents
  (id, company_id, doc_number, title, doc_type, discipline, project_id, party_ref, created_by_kind, created_by_id)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;

export const INSERT_REVISION = `
insert into ${NS}.erp_document_revisions
  (id, company_id, document_id, revision_code, revision_ordinal, review_state,
   supersedes_revision_id, asset_id, asset_sha256, asset_byte_size, asset_content_type,
   asset_filename, change_note, created_by_kind, created_by_id)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
`;

export const SET_CURRENT_REVISION = `
update ${NS}.erp_documents
   set current_revision_id = $3, updated_at = now()
 where company_id = $1
   and id = $2
`;

export const MARK_ASSET_VERIFIED = `
update ${NS}.erp_document_revisions
   set asset_verified_at = now(), asset_verified_sha256 = $3, updated_at = now()
 where company_id = $1
   and id = $2
`;

export const INSERT_EXTRACTION_RUN = `
insert into ${NS}.erp_extraction_runs
  (id, company_id, document_id, revision_id, extraction_method, extraction_tool, model_id,
   agent_id, run_id, issue_id, source_sha256, status, idempotency_key)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'started', $12)
`;

/**
 * Bulk value insert. One statement, N rows.
 *
 * `jsonb_to_recordset` is a function rather than a schema-qualified reference,
 * so the namespace validator sees only the INSERT target. Chunk the payload to
 * stay inside the plugin API body limit.
 */
export const INSERT_EXTRACTED_VALUES = `
insert into ${NS}.erp_extracted_values
  (id, company_id, document_id, revision_id, extraction_run_id, tag, attribute,
   value_text, value_numeric, unit, page_no, locator, confidence, origin, review_state)
select v.id, v.company_id, v.document_id, v.revision_id, v.extraction_run_id, v.tag, v.attribute,
       v.value_text, v.value_numeric, v.unit, v.page_no, v.locator, v.confidence, v.origin, 'unreviewed'
  from jsonb_to_recordset($1::jsonb) as v(
    id uuid, company_id uuid, document_id uuid, revision_id uuid, extraction_run_id uuid,
    tag text, attribute text, value_text text, value_numeric numeric, unit text,
    page_no integer, locator jsonb, confidence numeric, origin text
  )
on conflict (company_id, extraction_run_id, tag, attribute) do nothing
`;

export const COMMIT_EXTRACTION_RUN = `
update ${NS}.erp_extraction_runs
   set status = 'committed', committed_at = now(), value_count = $3, warnings = $4
 where company_id = $1
   and id = $2
`;

export const REVIEW_EXTRACTED_VALUE = `
update ${NS}.erp_extracted_values
   set review_state = $3,
       corrected_value_text = $4,
       corrected_unit = $5,
       review_note = $6,
       reviewed_by_user_id = $7,
       reviewed_at = now()
 where company_id = $1
   and id = $2
`;

/**
 * Compare-and-swap on the current state. `rowCount = 0` means someone else moved
 * the revision first - re-read and report the current state rather than retrying.
 */
export const TRANSITION_REVISION = `
update ${NS}.erp_document_revisions
   set review_state = $4, updated_at = now()
 where company_id = $1
   and id = $2
   and review_state = $3
`;

export const INSERT_STATE_TRANSITION = `
insert into ${NS}.erp_state_transitions
  (id, company_id, document_id, revision_id, from_state, to_state, actor_kind, actor_id,
   agent_id, run_id, approval_id, note, operation_id)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
`;

export const SET_RELEASED_REVISION = `
update ${NS}.erp_documents
   set released_revision_id = $3, current_revision_id = $3, updated_at = now()
 where company_id = $1
   and id = $2
`;

export const INSERT_RELEASE_GATE = `
insert into ${NS}.erp_release_gates
  (id, company_id, document_id, revision_id, gate_ref, gate_status)
values ($1, $2, $3, $4, $5, 'awaiting_link')
`;

export const LINK_RELEASE_GATE = `
update ${NS}.erp_release_gates
   set approval_id = $4, gate_status = 'pending', updated_at = now()
 where company_id = $1
   and gate_ref = $2
   and gate_status = $3
`;

export const SETTLE_RELEASE_GATE = `
update ${NS}.erp_release_gates
   set gate_status = $3, decided_by_user_id = $4, decided_at = now(),
       last_reconciled_at = now(), updated_at = now()
 where company_id = $1
   and id = $2
`;

export const INSERT_DIFF = `
insert into ${NS}.erp_revision_diffs
  (id, company_id, document_id, from_revision_id, to_revision_id, algorithm_version,
   input_fingerprint, added_count, removed_count, changed_count, unchanged_count, summary_text)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
on conflict (company_id, from_revision_id, to_revision_id, algorithm_version)
do update set input_fingerprint = excluded.input_fingerprint,
              added_count = excluded.added_count,
              removed_count = excluded.removed_count,
              changed_count = excluded.changed_count,
              unchanged_count = excluded.unchanged_count,
              summary_text = excluded.summary_text,
              computed_at = now()
`;

export const DELETE_DIFF_ENTRIES = `
delete from ${NS}.erp_revision_diff_entries
 where company_id = $1
   and diff_id = $2
`;

export const INSERT_DIFF_ENTRIES = `
insert into ${NS}.erp_revision_diff_entries
  (id, company_id, diff_id, change_kind, tag, attribute, from_value_text, to_value_text,
   from_unit, to_unit, numeric_delta, unit_changed)
select e.id, e.company_id, e.diff_id, e.change_kind, e.tag, e.attribute, e.from_value_text,
       e.to_value_text, e.from_unit, e.to_unit, e.numeric_delta, e.unit_changed
  from jsonb_to_recordset($1::jsonb) as e(
    id uuid, company_id uuid, diff_id uuid, change_kind text, tag text, attribute text,
    from_value_text text, to_value_text text, from_unit text, to_unit text,
    numeric_delta numeric, unit_changed boolean
  )
`;

/**
 * The narrative an agent may attach to an already-computed diff. It is
 * commentary; it can never alter the counts or entries above.
 */
export const SET_DIFF_NARRATIVE = `
update ${NS}.erp_revision_diffs
   set narrative_text = $3, narrative_origin = $4
 where company_id = $1
   and id = $2
`;

export const INSERT_ROLE_GRANT = `
insert into ${NS}.erp_role_grants
  (id, company_id, principal_kind, principal_id, erp_role, project_id, granted_by_user_id)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict do nothing
`;

/** Every read statement, for the validator pre-flight. */
export const READ_STATEMENTS: Readonly<Record<string, string>> = {
  SELECT_GRANTS_FOR_PRINCIPAL,
  SELECT_DOCUMENTS,
  SELECT_DOCUMENT_BY_ID,
  SELECT_REVISIONS_FOR_DOCUMENT,
  SELECT_PROVENANCE_BY_TAG,
  SELECT_VALUES_FOR_REVISION,
  SELECT_REVIEW_QUEUE,
  SELECT_RELEASE_GATE_FOR_REVISION,
  SELECT_OPERATION,
  SELECT_REVISION_STATE,
};

/** Every write statement, for the validator pre-flight. */
export const WRITE_STATEMENTS: Readonly<Record<string, string>> = {
  INSERT_OPERATION,
  SETTLE_OPERATION,
  ABANDON_STALE_OPERATIONS,
  INSERT_DOCUMENT,
  INSERT_REVISION,
  SET_CURRENT_REVISION,
  MARK_ASSET_VERIFIED,
  INSERT_EXTRACTION_RUN,
  INSERT_EXTRACTED_VALUES,
  COMMIT_EXTRACTION_RUN,
  REVIEW_EXTRACTED_VALUE,
  TRANSITION_REVISION,
  INSERT_STATE_TRANSITION,
  SET_RELEASED_REVISION,
  INSERT_RELEASE_GATE,
  LINK_RELEASE_GATE,
  SETTLE_RELEASE_GATE,
  INSERT_DIFF,
  DELETE_DIFF_ENTRIES,
  INSERT_DIFF_ENTRIES,
  SET_DIFF_NARRATIVE,
  INSERT_ROLE_GRANT,
};
