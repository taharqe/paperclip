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

Phase 0 (working environment) and Phase A (project operating system) are underway.
No ERP product code has been written yet.

- ✅ Repository reverse-engineered — see `doc/architecture/paperclip-analysis.md`
- ✅ ERP boundary decided — the ERP is a bundled first-party Paperclip **plugin**
  (see `doc/decisions/ADR-0001-erp-extension-boundary.md`)
- ✅ `pnpm install` completed
- 🔄 Baseline `pnpm -r typecheck` / `pnpm test:run` being recorded
- ⬜ Phase B — core plugin-host fixes H1–H3
- ⬜ Phase C — ERP slice 1

## Key architectural facts to re-read after any context loss

1. **The ERP is a plugin, not core.** `packages/plugins/plugin-llm-wiki` is the working template.
2. **Reuse core primitives**: blob storage (`server/src/storage/` + `assets`), `issues`,
   `approvals`, `activity_log`, `agents`, `projects`. Do not rebuild any of them.
3. **Plugin SQL is heavily constrained** — additive-only migrations, single-statement runtime SQL,
   no transactions, `execute` cannot touch `public`. See `paperclip-analysis.md` §9.
4. **Enforce ERP permissions server-side on `actor`**, never by curating an agent's tool list —
   the `paperclipApiRequest` MCP tool bypasses tool curation entirely.
5. **Never commit `pnpm-lock.yaml`** — CI blocks it; `refresh-lockfile.yml` owns it.
