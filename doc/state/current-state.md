# Current State

Updated: 2026-08-23
Branch: `claude/git-purpose-uzd0ke`

## What this project is

A hard fork of `paperclipai/paperclip` being extended into an **AI Industrial ERP**.

Three layers, deliberately separated:

| Layer | Role | Where it lives |
|---|---|---|
| Paperclip core | Control plane — agents, tasks, execution, budgets, governance | `server/`, `packages/db`, `ui/` |
| Industrial ERP | System of record — documents, engineering data, equipment | `packages/plugins/plugin-erp-*` |
| AI agents | System of action — extraction, analysis, coordination | Paperclip agents + ERP agent tools |

## Where we are

The ERP is **first-party code, not a plugin** — reversed after measuring the plugin boundary's
real cost. See `doc/decisions/ADR-0004-erp-as-first-party-packages.md`.

- ✅ Repository reverse-engineered — `doc/architecture/paperclip-analysis.md`
- ✅ Baseline recorded (typecheck clean; 903 tests pass, 3 pre-existing environmental failures)
- ✅ Phase B host improvements kept in core: `ctx.db.transaction([...])`, `assets` read whitelist.
  Generic and tested; the ERP no longer needs them but any plugin can use them.
- ✅ ERP migrated to `packages/erp-core` + `packages/db/src/schema/erp/`
  - Domain layer (deterministic diff, review-state machine, permission model) — 34 tests, moved
    untouched
  - 10 tables as typed Drizzle schema; migration `0094` (73 statements, ERP-only, no drops)
  - Schema invariants enforced by test — 5 tests
- ⬜ `packages/erp-core/src/services/` — persistence and business operations
- ⬜ `packages/erp-core/src/routes/` + the module registry seam in `server/src/app.ts`
- ⬜ ERP UI pages + nav
- ⬜ Native MCP agent tools

## Key architectural facts to re-read after any context loss

1. **The ERP is first-party.** `packages/erp-core` for logic, `packages/db/src/schema/erp/` for
   tables. Core gets ONE module-registry seam, not scattered wiring.
2. **Reuse core primitives**: blob storage and `assets`, `issues`, `approvals`, `activity_log`,
   `agents`, `projects`. Do not rebuild any of them.
3. **Four schema invariants are non-negotiable** and test-enforced: company-scoped and cascading,
   every index leads with `company_id`, no foreign key to `assets`, no approval-payload field
   matching the redaction pattern. See `CLAUDE.md` §4.
4. **Enforce ERP permissions server-side on `req.actor`**, never by curating an agent's tools —
   `paperclipApiRequest` bypasses tool curation entirely.
5. **Never commit `pnpm-lock.yaml`** in a PR — CI blocks it; `refresh-lockfile.yml` owns it. (This
   branch commits it out of necessity for new workspace packages.)
