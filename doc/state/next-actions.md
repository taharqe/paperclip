# Next Actions

Priority order. P0 = security/data-integrity/build-blocking, P1 = milestone blocker,
P2 = high-value functionality, P3 = tests/docs/refactor.

| # | P | Action |
|---|---|---|
| 1 | P1 | Record baseline `pnpm -r typecheck` and `pnpm test:run` results |
| 2 | P1 | Remove the stale `./packages/adapters/droid-local` reference from root `tsconfig.json` |
| 3 | P1 | Write root `CLAUDE.md` and `.claude/settings.json` |
| 4 | P1 | H1 — add `assets` to `PLUGIN_DATABASE_CORE_READ_TABLES` |
| 5 | P1 | H2 — generic `POST /api/companies/:companyId/assets` multipart route |
| 6 | P1 | H3 — `ctx.db.transaction([...])` namespace-scoped transaction RPC |
| 7 | P2 | Scaffold `packages/plugins/plugin-erp-core`, compute the DB namespace |
| 8 | P2 | ERP migrations, deterministic diff, lifecycle state machine |
| 9 | P2 | ERP agent tools + three managed agents |
| 10 | P2 | ERP UI shell |
| 11 | P3 | Register plugin packages in `vitest.config.ts` + `run-vitest-stable.mjs` so plugin tests run in CI |
