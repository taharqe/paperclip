import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { NAMESPACE_SLUG, PLUGIN_ID, PLUGIN_VERSION } from "./constants.js";

/**
 * Industrial ERP core - document control and engineering data provenance.
 *
 * Two structural notes:
 *
 *  1. Every operation is declared BOTH as an `apiRoutes` entry and a `tools`
 *     entry. The routes are the working path: core's plugin tool endpoints
 *     (`/api/plugins/tools`, `/plugins/tools/execute`) are board-only, so an
 *     agent cannot invoke a plugin tool today. Agents call the routes instead,
 *     with `paperclipApiRequest` or plain HTTP. The tool declarations exist for
 *     the board UI and tool registry, and for the day agent dispatch opens up.
 *     Never make an agent path depend on `tools`.
 *
 *  2. `coreReadTables` includes `assets` so the ERP can join the core blob
 *     record to confirm a document still exists and its checksum matches. The
 *     schema deliberately does not foreign-key it; see the migration header.
 */

const READ_ROUTE = {
  method: "GET",
  auth: "board-or-agent",
  capability: "api.routes.register",
  companyResolution: { from: "query", key: "companyId" },
} as const;

const WRITE_ROUTE = {
  method: "POST",
  auth: "board-or-agent",
  capability: "api.routes.register",
  companyResolution: { from: "body", key: "companyId" },
} as const;

/** Shared JSON Schema fragment for the company scope every operation carries. */
const companyIdProperty = { type: "string", description: "Company that owns the record." } as const;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Industrial ERP",
  description:
    "Industrial document control: document register, revision management, engineering data extraction with full provenance, deterministic revision comparison, and human-authorised release.",
  author: "Paperclip",
  categories: ["automation", "ui"],
  capabilities: [
    "api.routes.register",
    "agent.tools.register",
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "companies.read",
    "projects.read",
    "agents.read",
    "agents.managed",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "events.subscribe",
    "jobs.schedule",
    "activity.log.write",
    "plugin.state.read",
    "plugin.state.write",
    "ui.sidebar.register",
    "ui.page.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  database: {
    namespaceSlug: NAMESPACE_SLUG,
    migrationsDir: "migrations",
    coreReadTables: ["companies", "projects", "agents", "issues", "approvals", "assets"],
  },
  jobs: [
    {
      jobKey: "reconcile-release-gates",
      displayName: "Reconcile ERP release gates",
      description:
        "Re-reads pending release gates against core approvals. Domain events are best-effort, so this is what makes a gate outcome eventually consistent.",
      schedule: "*/15 * * * *",
    },
    {
      jobKey: "reconcile-operations",
      displayName: "Reconcile abandoned ERP operations",
      description:
        "Marks idempotency-ledger entries abandoned when they were started but never settled, so a retry is not blocked forever.",
      schedule: "*/15 * * * *",
    },
  ],
  agents: [
    {
      agentKey: "erp-project-agent",
      displayName: "ERP Project Agent",
      role: "manager",
      title: "Industrial Project Coordinator",
      capabilities:
        "Reports project document status, surfaces blockers and approaching deadlines, and creates review tasks. Read-only over ERP records.",
      adapterType: "claude_local",
      adapterPreference: ["claude_local", "codex_local", "opencode_local", "gemini_local"],
      status: "paused",
      budgetMonthlyCents: 0,
      instructions: { assetPath: "agents/erp-project-agent" },
    },
    {
      agentKey: "erp-engineering-agent",
      displayName: "ERP Engineering Agent",
      role: "engineer",
      title: "Engineering Data Analyst",
      capabilities:
        "Extracts engineering data from controlled documents with per-value provenance, compares revisions, and detects missing data. Cannot approve or release anything.",
      adapterType: "claude_local",
      adapterPreference: ["claude_local", "codex_local", "opencode_local", "gemini_local"],
      status: "paused",
      budgetMonthlyCents: 0,
      instructions: { assetPath: "agents/erp-engineering-agent" },
    },
    {
      agentKey: "erp-doc-control-agent",
      displayName: "ERP Document Control Agent",
      role: "operator",
      title: "Document Controller",
      capabilities:
        "Classifies incoming documents, maintains metadata and revision sequences, and routes revisions into review. Cannot approve or release anything.",
      adapterType: "claude_local",
      adapterPreference: ["claude_local", "codex_local", "opencode_local", "gemini_local"],
      status: "paused",
      budgetMonthlyCents: 0,
      instructions: { assetPath: "agents/erp-doc-control-agent" },
    },
  ],
  tools: [
    {
      name: "erp_list_documents",
      displayName: "List ERP documents",
      description: "List documents in the register, filtered by project, type or review state.",
      parametersSchema: {
        type: "object",
        required: ["companyId"],
        properties: {
          companyId: companyIdProperty,
          projectId: { type: "string" },
          docType: { type: "string" },
          reviewState: { type: "string" },
          q: { type: "string", description: "Free-text match on document number or title." },
          limit: { type: "number", maximum: 200 },
          cursor: { type: "string" },
        },
      },
    },
    {
      name: "erp_get_document",
      displayName: "Get an ERP document",
      description: "Fetch one document with its full revision history.",
      parametersSchema: {
        type: "object",
        required: ["companyId", "documentId"],
        properties: { companyId: companyIdProperty, documentId: { type: "string" } },
      },
    },
    {
      name: "erp_get_provenance",
      displayName: "Trace where a value came from",
      description:
        "Answer 'where did this value come from?' - returns each extracted value with its source document, revision, page, locator, extraction method, model, confidence and review state.",
      parametersSchema: {
        type: "object",
        required: ["companyId"],
        properties: {
          companyId: companyIdProperty,
          tag: { type: "string", description: "Equipment tag, e.g. FV-1042." },
          attribute: { type: "string" },
          valueId: { type: "string" },
          revisionId: { type: "string" },
        },
      },
    },
    {
      name: "erp_submit_extraction",
      displayName: "Submit extracted engineering data",
      description:
        "Record engineering values extracted from a document revision. Values always enter as AI_GENERATED and unreviewed; this can never produce approved engineering information.",
      parametersSchema: {
        type: "object",
        required: ["companyId", "revisionId", "idempotencyKey", "extractionMethod", "values"],
        properties: {
          companyId: companyIdProperty,
          revisionId: { type: "string" },
          idempotencyKey: { type: "string" },
          extractionMethod: {
            type: "string",
            enum: ["llm_vision", "llm_text", "ocr", "parser", "manual"],
          },
          modelId: { type: "string" },
          sourceSha256: {
            type: "string",
            description: "Checksum of the bytes actually read, so provenance is verifiable.",
          },
          values: {
            type: "array",
            maxItems: 1000,
            items: {
              type: "object",
              required: ["tag", "attribute", "valueText"],
              properties: {
                tag: { type: "string" },
                attribute: { type: "string" },
                valueText: { type: "string" },
                valueNumeric: { type: "number" },
                unit: { type: "string" },
                pageNo: { type: "number" },
                locator: { type: "object" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
            },
          },
        },
      },
    },
    {
      name: "erp_compare_revisions",
      displayName: "Compare two revisions",
      description:
        "Deterministically compare the engineering data of two revisions. The comparison is computed in code, never by a model.",
      parametersSchema: {
        type: "object",
        required: ["companyId", "documentId", "fromRevisionId", "toRevisionId"],
        properties: {
          companyId: companyIdProperty,
          documentId: { type: "string" },
          fromRevisionId: { type: "string" },
          toRevisionId: { type: "string" },
        },
      },
    },
    {
      name: "erp_transition_revision",
      displayName: "Move a revision through review",
      description:
        "Advance a revision's review state. An agent can move a revision toward review but can never reach APPROVED or RELEASED.",
      parametersSchema: {
        type: "object",
        required: ["companyId", "revisionId", "fromState", "toState", "idempotencyKey"],
        properties: {
          companyId: companyIdProperty,
          revisionId: { type: "string" },
          fromState: { type: "string" },
          toState: { type: "string" },
          note: { type: "string" },
          idempotencyKey: { type: "string" },
        },
      },
    },
  ],
  apiRoutes: [
    { routeKey: "list-documents", path: "/documents", ...READ_ROUTE },
    { routeKey: "get-document", path: "/documents/:documentId", ...READ_ROUTE },
    { routeKey: "get-provenance", path: "/provenance", ...READ_ROUTE },
    { routeKey: "get-diff", path: "/documents/:documentId/diff", ...READ_ROUTE },
    { routeKey: "list-review-queue", path: "/review-queue", ...READ_ROUTE },
    { routeKey: "bootstrap", path: "/bootstrap", ...WRITE_ROUTE, auth: "board" },
    { routeKey: "register-document", path: "/documents", ...WRITE_ROUTE },
    { routeKey: "add-revision", path: "/documents/:documentId/revisions", ...WRITE_ROUTE },
    { routeKey: "verify-asset", path: "/revisions/:revisionId/verify-asset", ...WRITE_ROUTE },
    { routeKey: "submit-extraction", path: "/revisions/:revisionId/extractions", ...WRITE_ROUTE },
    { routeKey: "compute-diff", path: "/documents/:documentId/diff", ...WRITE_ROUTE },
    { routeKey: "explain-diff", path: "/diffs/:diffId/explain", ...WRITE_ROUTE },
    { routeKey: "review-value", path: "/extracted-values/:valueId/review", ...WRITE_ROUTE },
    { routeKey: "transition-revision", path: "/revisions/:revisionId/transition", ...WRITE_ROUTE },
    {
      routeKey: "prepare-release-approval",
      path: "/revisions/:revisionId/release-approval/prepare",
      ...WRITE_ROUTE,
      auth: "board",
    },
    {
      routeKey: "link-release-approval",
      path: "/revisions/:revisionId/release-approval/link",
      ...WRITE_ROUTE,
      auth: "board",
    },
  ],
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "erp-sidebar",
        displayName: "ERP",
        exportName: "SidebarLink",
        order: 30,
      },
      {
        type: "page",
        id: "erp-page",
        displayName: "ERP",
        exportName: "ErpPage",
        routePath: "erp",
      },
      {
        type: "routeSidebar",
        id: "erp-route-sidebar",
        displayName: "ERP",
        exportName: "ErpRouteSidebar",
        routePath: "erp",
      },
    ],
  },
};

export default manifest;
