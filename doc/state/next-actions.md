# Next Actions

Priority order. P0 = security/data-integrity/build-blocking, P1 = milestone blocker,
P2 = high-value functionality, P3 = tests/docs/refactor.

| # | P | Action |
|---|---|---|
| 1 | P1 | `packages/erp-core/src/services/` — documents, revisions, extraction, diff, review, release gate. Typed Drizzle, company-scoped in every query including single-row reads. |
| 2 | P1 | Module registry seam: `server/src/modules/index.ts` + one loop in `app.ts`, so ERP routes mount without scattering wiring |
| 3 | P1 | `packages/erp-core/src/routes/` — the HTTP surface, permissions checked against `req.actor`, `logActivity` on every mutation |
| 4 | P2 | ERP UI: register, document detail with provenance, diff view, review queue. Uses the real design system; must be usable with zero AI interaction. |
| 5 | P2 | Native MCP agent tools in `packages/mcp-server` — now possible, unlike plugin tools |
| 6 | P2 | Real-Postgres integration test for the ERP services (blocked locally — see known-issues K11) |
| 7 | P3 | Backfill `plugin-llm-wiki` / `plugin-workspace-diff` into the CI vitest lists so their tests run |
| 8 | P3 | Host fix for K10: strip comments before quoted literals in `stripSqlForKeywordScan` |

## Done

Phases 0, A, B; ERP domain layer, schema and migration; migration from plugin to first-party
packages (`619ba36` … `f51655e`).
