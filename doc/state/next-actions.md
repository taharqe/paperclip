# Next Actions

Priority order. P0 = security/data-integrity/build-blocking, P1 = milestone blocker,
P2 = high-value functionality, P3 = tests/docs/refactor.

| # | P | Action |
|---|---|---|
| 1 | P1 | Implement `src/erp/sql.ts` — every statement as a named const, pre-flighted through the real validators |
| 2 | P1 | Implement `src/erp/operations.ts` + `src/worker.ts` — read routes first, then writes |
| 3 | P1 | Release gate (`prepare`/`link`), `approval.decided` subscription, reconcile jobs |
| 4 | P2 | ERP UI shell: register, document detail with provenance, diff view, review queue |
| 5 | P2 | Real-Postgres test applying the migration and exercising the atomic write (CI only — embedded Postgres does not start in this sandbox) |
| 6 | P3 | Backfill `plugin-llm-wiki` / `plugin-workspace-diff` into the CI vitest lists so their tests run too |
| 7 | P3 | Host fix for K10: strip comments before quoted literals in `stripSqlForKeywordScan` |

## Done

Phases 0, A and B; ERP scaffold, schema, pure cores and manifest (commits `619ba36`,
`c72dfd2`, `1d6e8a8`, `e0d2bae`, `dea7930`).
