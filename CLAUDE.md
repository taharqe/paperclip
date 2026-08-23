# CLAUDE.md — Engineering Operating Manual

This repository is a hard fork of `paperclipai/paperclip` being extended into an
**AI Industrial ERP**.

`AGENTS.md` remains the base engineering contract for the Paperclip codebase — **read it first**.
This file adds the rules specific to the ERP programme. Where the two agree, `AGENTS.md` wins on
Paperclip conventions; this file wins on ERP boundaries.

> `AGENTS.md` §11 ("Fork-Specific: HenkDz/paperclip") describes a **different** fork and is not
> authoritative here. `AGENTS.md` also states dev uses PGlite; the code actually uses
> `embedded-postgres`. See `doc/state/known-issues.md`.

---

## 1. The three layers

| Layer | Role | Lives in |
|---|---|---|
| **Paperclip core** | Control plane — agents, tasks, execution, budgets, governance | `server/`, `packages/db`, `packages/shared`, `ui/` |
| **Industrial ERP** | System of record — documents, engineering data, equipment | `packages/plugins/plugin-erp-*` |
| **AI agents** | System of action — extraction, analysis, coordination | Paperclip agents driving ERP tools |

Paperclip stays the control plane. The ERP is the system of record. Humans remain responsible for
controlled decisions.

## 2. Placement rule — apply to every new capability

Ask in order; **first match wins**:

1. Does core already have it? → **reuse it.** (storage/`assets`, `issues`, `approvals`,
   `activity_log`, `agents`, `projects`, `goals`, heartbeats, budgets)
2. Is it a generic gap in the *plugin system*? → smallest possible core fix, with tests, carrying
   **no ERP vocabulary**.
3. Is it ERP business logic? → `plugin-erp-core`.
4. Is it industrial-domain logic? → `plugin-erp-industrial`.
5. Is it an external system? → an integration module behind an interface.

Before creating an abstraction, check whether one exists. Before adding a dependency, check whether
the repo already solves it.

## 3. Forbidden without explicit discussion

Do not modify these for ERP work. They are the highest-blast-radius files in the repo:

- `server/src/services/heartbeat.ts` — the execution engine
- `server/src/services/issues.ts` — checkout compare-and-swap; a `WHERE` change silently breaks atomicity
- `server/src/routes/issues.ts`
- `server/src/middleware/auth.ts` — sole actor resolution; a wrong `next()` is an auth bypass
- `server/src/routes/authz.ts` — every tenant boundary in the product
- `server/src/services/authorization.ts`
- `server/src/app.ts` — middleware ordering is semantic
- `packages/db/src/client.ts` and `packages/db/src/migrations/*` — append-only, checksum-verified

Also never: add ERP values to closed core enums (`APPROVAL_TYPES`, `PERMISSION_KEYS`,
`ISSUE_STATUSES`); commit `pnpm-lock.yaml`; or write ERP domain logic into `packages/shared`.

## 4. Plugin constraints you must design around

Verified in `server/src/services/plugin-database.ts`:

- Migrations are **additive-only** — `DROP`/`TRUNCATE` rejected. No extensions, triggers, functions.
- The DB namespace is hash-derived (`plugin_<slug>_<hash>`) and **is not substituted** — migration
  SQL hardcodes the literal schema name.
- `ctx.db.query()` — one statement, must start `select `/`with `, no mutation or DDL keywords.
- `ctx.db.execute()` — one statement, must start `insert into`/`update`/`delete from`, and
  **cannot reference `public` at all**. Denormalise `company_id` into ERP tables.
- Plugin API routes are **JSON-only** and mount at `/api/plugins/:pluginId/api/*`. File upload must
  go through a core route.
- **Agents cannot call plugin tools.** `/api/plugins/tools` and `/plugins/tools/execute` are
  board-only. Agent-facing operations must be `manifest.apiRoutes` with `auth: "agent"` or
  `"board-or-agent"`. Declare `manifest.tools[]` too, but never depend on it for agent access.
- `ctx.assets` does not exist — a worker cannot read file bytes. Agents fetch them over HTTP with
  their own credentials.

Full detail: `doc/architecture/paperclip-analysis.md` §9.

## 5. Security and permissions

- **Company-scope everything.** Every ERP table carries `company_id`; every query filters on it,
  including single-row reads. Core has no RLS — isolation is entirely your responsibility.
- **Enforce permissions server-side against `actor`**, in `onApiRequest`. Never rely on which tools
  an agent was given: the `paperclipApiRequest` MCP tool lets any agent call any REST path, so tool
  curation is **not** a security boundary.
- **Least privilege.** An agent gets the minimum ERP grants for its role. No agent may approve or
  release.
- Never hard-code credentials. Never expose keys in frontend code.
- Write an `activity_log` entry for every mutation.

## 6. Human-in-the-loop and safety-critical language

ERP records move through: `DRAFT → AI_GENERATED → REQUIRES_REVIEW → APPROVED → RELEASED`
(or `REJECTED`).

- **AI output must never appear as approved engineering information.** Anything an agent writes
  enters as `AI_GENERATED`.
- Only a human actor with the release grant can reach `APPROVED` or `RELEASED`.
- **Never claim "safe", "compliant", "certified" or "approved"** unless backed by explicit evidence
  and human authorisation. AI may detect, calculate, compare, recommend, summarise, prepare and
  flag. It may not give final safety approval.
- **LLMs interpret; deterministic code calculates.** Revision diffs, engineering calculations and
  unit conversions are plain TypeScript with unit tests. An LLM may *explain* a computed result; it
  may never *produce* one.

## 7. No fake features

Never ship fake integrations, mock data presented as real, hard-coded AI answers, fabricated
automation metrics, or invented engineering calculations. If something is not implemented, label it
`NOT IMPLEMENTED` in the UI. Do not hide incomplete functionality behind polished UI.

## 8. Verification

| Scope | Command |
|---|---|
| Fastest inner loop | `pnpm exec vitest run <path/to/file.test.ts>` |
| Scoped typecheck | `pnpm --filter @paperclipai/<pkg> typecheck` |
| Full pre-handoff gate | `pnpm -r typecheck && pnpm test:run && pnpm build` |
| After a core schema change | `pnpm db:generate && pnpm -r typecheck` |

Per `AGENTS.md` §7, run the **smallest relevant verification first**. Do not default to repo-wide
checks on every edit.

- There is **no ESLint, Prettier or Biome** in this repo, and no `lint`/`format` script. Do not
  invent one.
- Tests needing a real database **must** use `server/src/__tests__/helpers/embedded-postgres.ts`.
- UI DOM tests need `// @vitest-environment jsdom` on line 1.
- A new plugin package must be registered in root `vitest.config.ts` `projects` **and**
  `scripts/run-vitest-stable.mjs` `nonServerProjects`, or its tests never run in CI.
- A new workspace package must be added to the `Dockerfile` deps stage
  (`scripts/check-docker-deps-stage.mjs` fails CI otherwise).

## 9. Definition of done

Implementation exists · tests exist and pass · typecheck passes · permissions reviewed ·
company scoping reviewed · error handling implemented · audit logging in place · docs updated ·
diff self-reviewed · no regression introduced.

A feature that merely compiles is not done.

## 10. Project memory

Re-read these after any context loss, `/clear`, `/compact` or session restart:

- `doc/state/current-state.md` — where the project is
- `doc/state/current-milestone.md` — what "done" means right now
- `doc/state/next-actions.md` — the prioritised queue
- `doc/state/blockers.md` · `doc/state/known-issues.md`
- `doc/decisions/` — architectural decisions and their rationale
- `doc/architecture/paperclip-analysis.md` — how Paperclip actually works

Update them after meaningful work. Never rely on conversation memory alone.

## 11. Git

- New plan documents go in `doc/plans/` as `YYYY-MM-DD-slug.md` (`AGENTS.md` §5.5).
- Conventional commits matching repo history: `feat(erp): …`, `feat(plugins): …`,
  `fix(plugin-database): …`. One logical change per commit.
- Never force-push or rewrite shared history. Never commit secrets. Never commit `pnpm-lock.yaml`.
