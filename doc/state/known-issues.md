# Known Issues

Pre-existing defects found while reverse-engineering the repo. None were introduced by ERP work.
Recorded so they are never mistaken for regressions.

| # | Issue | Evidence | Action |
|---|---|---|---|
| K1 | Root `tsconfig.json` references `./packages/adapters/droid-local`, which does not exist and was never committed. `droid_local` is an *externally installed* npm adapter. | `tsconfig.json:12`; `git log` shows no such path | Remove the stale reference |
| K2 | `pnpm-lock.yaml` in the repo is missing the `packages/skills-catalog: {}` importer entry, so `pnpm install` dirties it every time | `git diff pnpm-lock.yaml` after a clean install | Do not commit. `refresh-lockfile.yml` owns the lockfile |
| K3 | Plugin packages are absent from root `vitest.config.ts` `projects` and `scripts/run-vitest-stable.mjs` `nonServerProjects`, so **their tests never run in CI** | Both lists are hardcoded and omit `plugin-llm-wiki` / `plugin-workspace-diff` | Register `plugin-erp-core` in both; consider backfilling the others |
| K4 | `AGENTS.md` says dev uses PGlite; the code uses `embedded-postgres` | `AGENTS.md` §4 vs `server/src/index.ts`, `doc/DATABASE.md` | Additive correction only — do not rewrite the file |
| K5 | `AGENTS.md` has two `## 11.` headings, and a fork-specific section for a *different* fork (`HenkDz/paperclip`) | `AGENTS.md` | Leave alone unless asked; note in `CLAUDE.md` that §11 is not authoritative here |
| K6 | `adapter-plugin.md` at the repo root is an AI agent work-log, not a specification | File content | Treat as debris; do not cite it as a contract |
| K7 | Activity→plugin-event mapping is a hand-maintained 13-entry alias table; unmapped actions emit no plugin event | `server/src/services/activity-log.ts` | ERP emits its own `plugin.<id>.*` events rather than relying on core coverage |
| K8a | `POST /api/companies/:companyId/assets/images` is misleadingly named — it accepts **any** content type in the process allowlist (pdf, csv, text, json, markdown, html), not just images. Only `/companies/:companyId/logo` is genuinely image-only. | `server/src/routes/assets.ts`; `isAllowedContentType` in `server/src/attachment-types.ts`; covered by tests in `server/src/__tests__/assets.test.ts` | Behaviour is correct and now test-pinned; only the name is wrong. Renaming would break existing UI callers, so leave it and rely on the tests |
| K8 | `getServerAdapter()` silently falls back to the process adapter for unknown adapter types | `server/src/adapters/registry.ts` | Awareness only |
