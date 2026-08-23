# Next Actions

Priority order. P0 = security/data-integrity/build-blocking, P1 = milestone blocker,
P2 = high-value functionality, P3 = tests/docs/refactor.

| # | P | Action |
|---|---|---|
| 1 | P1 | ~~Record baseline~~ ✅ typecheck passes; test suite recorded `pnpm -r typecheck` and `pnpm test:run` results |
| 2 | P1 | ~~Remove the stale~~ ✅ done — stale `./packages/adapters/droid-local` reference from root `tsconfig.json` |
| 3 | P1 | ~~Write root `CLAUDE.md`~~ ✅ done |
| 4 | P1 | ~~H1~~ ✅ done — `assets` added to `PLUGIN_DATABASE_CORE_READ_TABLES` |
| 5 | P1 | H3 — `ctx.db.transaction([...])` namespace-scoped transaction RPC |
| 6 | P2 | Scaffold `packages/plugins/plugin-erp-core`, compute the DB namespace |
| 7 | P2 | ERP migrations, deterministic diff, lifecycle state machine |
| 8 | P2 | ERP agent tools + three managed agents |
| 9 | P2 | ERP UI shell |
| 10 | P3 | Register plugin packages in `vitest.config.ts` + `run-vitest-stable.mjs` so plugin tests run in CI |
