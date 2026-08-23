# Paperclip Architecture Analysis

Status: reference analysis for the AI Industrial ERP programme
Date: 2026-08-23
Scope: how Paperclip actually works, verified by reading the code at commit `8014445`

This document exists to answer one question before any ERP code is written: **what is Paperclip,
structurally, and where can it be extended without breaking it?**

Every claim below was verified against source. Paths are repo-relative; line numbers are
indicative and will drift.

---

## 1. Shape of the system

Paperclip is a pnpm monorepo. There is no Turbo/Nx — orchestration is `pnpm -r` plus custom
Node scripts in `scripts/`.

| Area | Path | Role |
|---|---|---|
| HTTP server + orchestration | `server/` | Express 5 REST API, heartbeat scheduler, plugin host |
| Board UI | `ui/` | React 19 + Vite + Tailwind v4 + shadcn/ui |
| Schema + migrations | `packages/db/` | Drizzle ORM over postgres.js |
| Types/constants/validators | `packages/shared/` | Hand-maintained DTOs shared by server and UI |
| Agent adapters | `packages/adapters/*` | One package per agent runtime |
| Adapter runtime helpers | `packages/adapter-utils/` | Published contract for third-party adapters |
| Plugin SDK + plugins | `packages/plugins/` | Plugin API v1, examples, first-party plugins |
| MCP stdio server | `packages/mcp-server/` | Exposes Paperclip to agents as MCP tools |
| Skills catalog | `packages/skills-catalog/` | Distributable agent skills |
| CLI | `cli/` | `paperclipai` published CLI |

**There is no codegen between server and UI** — no OpenAPI, tRPC, or ts-rest. Contracts are
hand-maintained in `packages/shared` and held together by `pnpm -r typecheck` plus the rule in
`AGENTS.md` §5.2 that a schema/API change must update db, shared, server and ui together.

---

## 2. Server

### Bootstrap
`server/src/index.ts` → `startServer()`. Ordering matters and is load-bearing:

1. Load config + telemetry.
2. `assertCloudDatabaseContract()` — an `authenticated` + `public` deployment **must** have a real
   Postgres `DATABASE_URL`; it refuses to fall back to embedded Postgres.
3. Database: external `DATABASE_URL`, otherwise an embedded PostgreSQL instance under
   `~/.paperclip/instances/default/db`.
4. Migration gate — refuses to boot on pending migrations unless `PAPERCLIP_MIGRATION_AUTO_APPLY=true`
   or an interactive TTY confirms.
5. Deployment-mode invariants (`local_trusted` must bind loopback + private exposure).
6. `createApp()`, HTTP server, WebSocket live events.
7. Startup reconciliation of runtime services and cloud upstream runs.
8. Heartbeat + routine scheduler.
9. `await waitForExternalAdapters()` **before** `listen` — avoids an adapter-type validation race.

### HTTP layer
`server/src/app.ts` → `createApp(db, opts)` is the single mount point. The middleware chain is
semantic and must not be reordered:

```
express.json (scoped + global) → httpLogger → privateHostnameGuard → actorMiddleware
  → /api/auth → api router (boardMutationGuard first) → domain routers
  → /api 404 catch-all → plugin UI static → UI static/Vite → errorHandler (last)
```

Express 5's native async-rejection forwarding is relied upon: handlers are `async` and `throw`,
with no try/catch and no `asyncHandler` wrapper. There is a regression test for this
(`server/src/__tests__/express5-auth-wildcard.test.ts`).

### Route module convention
`server/src/routes/goals.ts` is the canonical template. Each handler does five things:

```ts
export function goalRoutes(db: Db) {
  const router = Router();
  const svc = goalService(db);
  router.post("/companies/:companyId/goals",
    validate(createGoalSchema),                  // 1. zod body validation
    async (req, res) => {
      assertCompanyAccess(req, companyId);       // 2. tenant gate
      const goal = await svc.create(...);        // 3. service call
      await logActivity(db, { ... });            // 4. audit
      res.status(201).json(goal);                // 5. bare entity, no envelope
    });
  return router;
}
```

Registration is `export` from `server/src/routes/index.ts` plus one `api.use(...)` line in `app.ts`.

Two mount styles coexist: prefixed (`api.use("/companies", companyRoutes(...))`, relative paths
inside) and rootless (`api.use(goalRoutes(db))`, full paths inside). Rootless is the majority.

### Errors and responses
- `server/src/errors.ts`: `HttpError` plus `badRequest` 400, `unauthorized` 401, `forbidden` 403,
  `notFound` 404, `conflict` 409, `unprocessable` 422. No 500 factory.
- `server/src/middleware/error-handler.ts`: `HttpError` → `{ error, details? }`; `ZodError` → 400
  `{ error: "Validation error", details }`; anything else → 500 `{ error: "Internal server error" }`.
- **No response envelope** — handlers return bare entities or arrays.
- Body validation is zod. **Query parameters are not zod-validated anywhere** — they are hand-parsed
  with regex/`Number()` and manual 400s.
- Pagination is offset-based (`limit`/`offset`), opt-in per route, no cursors. Total counts are a
  separate endpoint.

---

## 3. Data layer

Drizzle ORM 0.45 over postgres.js. `packages/db/src/schema/` holds **one file per table**
(86 exports), re-exported from `schema/index.ts`.

### Migrations
- `packages/db/src/migrations/NNNN_name.sql`, currently `0000`–`0093`.
- Generated by `drizzle-kit` reading the **compiled** schema (`drizzle.config.ts` points at
  `dist/schema/*.js`), so `pnpm db:generate` compiles `packages/db` first.
- **Forward-only. There are no down migrations.**
- Hand-edited migrations are common and idempotent by convention
  (`CREATE TABLE IF NOT EXISTS`, `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint ...)`).
- `packages/db/src/check-migration-numbering.ts` guards numbering/order/journal consistency and runs
  on build, typecheck, generate and migrate.
- `packages/db/src/client.ts` contains unusually elaborate machinery: a manual per-statement
  applier and a journal self-repair path that introspects `pg_class`/`information_schema` to infer
  whether a migration already ran. This is scar tissue from real drift incidents — treat it as
  high-risk code.

### Conventions
- Primary keys: `uuid("id").primaryKey().defaultRandom()` almost everywhere. No nanoid, no prefixed IDs.
- **User IDs are `text`**, not uuid — better-auth owns them. Every `*_by_user_id` / `principal_id`
  column is `text`.
- Timestamps: `timestamptz` with `defaultNow()`; `updated_at` is set manually by services, **not** by
  a database trigger.
- Tenancy: `company_id uuid NOT NULL REFERENCES companies(id)` on virtually every domain table.
  `onDelete` behaviour is **inconsistent** — older tables omit it, newer ones cascade; migration
  `0093` exists purely to retrofit cascade onto two tables.
- **No uniform soft delete.** Per-entity flags instead: `issues.hidden_at`, `projects.archived_at`,
  `execution_workspaces.closed_at`, `company_secrets.deleted_at`, plus status enums.

---

## 4. Identity and authorization

### Deployment modes
`local_trusted` (no login, loopback only) and `authenticated` (login required), the latter with
`private` or `public` exposure. Bind is a separate concern: `loopback | lan | tailnet | custom`.

### Actor resolution
`server/src/middleware/auth.ts` resolves `req.actor`. There are only **three actor types** —
`board`, `agent`, `none` — discriminated by six `source` values:

| source | How it is obtained |
|---|---|
| `local_implicit` | `local_trusted` mode synthesises a board principal `local-board` |
| `session` | better-auth session cookie |
| `board_key` | `Authorization: Bearer` matching a `board_api_keys` row |
| `agent_key` | Bearer token, sha256-hashed lookup in `agent_api_keys` where `revoked_at IS NULL` |
| `agent_jwt` | Hand-rolled HS256 run JWT (`server/src/agent-auth-jwt.ts`), 48h default TTL |
| `cloud_tenant` | `x-paperclip-cloud-tenant-token` header, timing-safe compared against a shared secret; **auto-provisions** the user, instance-admin role and company, with a SHA-256-derived company UUID |

`X-Paperclip-Run-Id` is attached to the actor in every path as `actor.runId`.

> `plugin` is an actor type in the **activity log only**, not in the HTTP actor.

### Tenant isolation
**There is no Postgres RLS and no repository layer.** Isolation is two manual, opt-in layers:

1. `assertCompanyAccess(req, companyId)` (`server/src/routes/authz.ts`) — agent actors must match
   `companyId`; board actors must have the company in `actor.companyIds`; on unsafe methods
   non-instance-admins additionally need an `active` membership and must not be `viewer`.
2. A hand-written `eq(table.companyId, companyId)` predicate in every service query.

A common pattern is *fetch-then-check*: load a row by ID with no tenant predicate, then call
`assertCompanyAccess(req, row.companyId)`. Correct, but it means single-row lookups run untenanted
and correctness depends entirely on discipline. Dedicated guards exist:
`server/src/__tests__/agent-cross-tenant-authz-routes.test.ts`, `authz-company-access.test.ts`.

### RBAC
A central primitive **does** exist: `authorizationService(db).decide({ actor, action, resource, scope })`
in `server/src/services/authorization.ts`, returning `{ allowed, action, explanation, reason, grant? }`
with enumerated `deny_*`/`allow_*` reason codes.

But adoption is thin — roughly **6 non-test call sites** against ~26k lines of routes. Everything
else uses the coarse `assertCompanyAccess` / `assertBoard` / `assertInstanceAdmin` helpers.

`PERMISSION_KEYS` is a **closed 8-value set**: `agents:create`, `environments:manage`, `users:invite`,
`users:manage_permissions`, `tasks:assign`, `tasks:assign_scope`, `tasks:manage_active_checkouts`,
`joins:approve`. It models organisational administration, **not** resource-level domain permissions.

---

## 5. Work model

Task = **issue** (`packages/db/src/schema/issues.ts`).

- Statuses: `backlog | todo | in_progress | in_review | done | blocked | cancelled`.
- Priorities: `critical | high | medium | low`. Work modes: `standard | planning`.
- **Single assignee** — `assignee_agent_id` XOR `assignee_user_id`.
- Hierarchy via `parent_id` self-FK, with `request_depth` capped as a delegation guard.
- Dependencies via `issue_relations`, type `"blocks"` only.
- `origin_kind` is an open template type that includes `` plugin:${string} `` — plugins can create
  first-class issues attributed to themselves.
- Human identifier `PREFIX-N` allocated inside a transaction with a self-correcting counter.

### Atomic checkout is real
`issueService.checkout()` is a **single conditional UPDATE whose WHERE clause is the
compare-and-swap** — status must be in `expectedStatuses`, the assignee must be null or the same
run, and the execution lock must be free. Zero rows updated triggers three recovery paths
(adopt an unowned lock, adopt a stale run, or return if this run already owns it) before throwing
`conflict` → HTTP 409.

Run claiming is a second CAS: `UPDATE heartbeat_runs SET status='running' WHERE id=? AND status='queued'`.

Two distinct locks live on `issues`: `checkout_run_id` (the claim) and
`execution_run_id` + `execution_agent_name_key` + `execution_locked_at` (the running run).

### Projects and goals
Paperclip already has a first-class **project**: company-scoped, with `status`, `lead_agent_id`,
`target_date`, `env`, `execution_workspace_policy`, `archived_at`. It owns workspaces
(`project_workspaces`), membership (`project_memberships`), goals (`project_goals` M:N) and
authorization policy. `goals` is a separate self-nesting tree. Issues carry both `project_id` and
`goal_id`.

---

## 6. Execution: heartbeats and routines

A **single `setInterval`** in the API process (default 30s, floor 10s), gated by
`HEARTBEAT_SCHEDULER_ENABLED`. Each tick runs, in parallel:

- `heartbeat.tickTimers(now)` — scans agents, skips paused/terminated/pending_approval, compares
  elapsed time against the agent's interval policy, enqueues wakeups; then ticks due issue monitors.
- `routines.tickScheduledTriggers(now)` — cron scheduling via a **hand-written parser**
  (`server/src/services/cron.ts`, no library), claimed with a CAS on `next_run_at`.
- A recovery cascade: `reapOrphanedRuns` → `promoteDueScheduledRetries` → `resumeQueuedRuns` →
  `reconcileStrandedAssignedIssues` → `reconcileIssueGraphLiveness` → `scanSilentActiveRuns` →
  `reconcileProductivityReviews`.

**Work is resumable across process restart** because all run state lives in `heartbeat_runs`.
`reapOrphanedRuns` finds rows stuck in `running` that are absent from the in-memory sets; if the
recorded PID is still alive it marks the run detached rather than killing it.

> **Single-process by construction.** `withAgentStartLock` is an in-memory `Map`;
> `activeRunExecutions` and `runningProcesses` are process-local sets; live events use a
> module-level `EventEmitter`; the scheduler has no leader election. Two API replicas would
> double-fire timers and mis-reap each other's runs. The DB CAS operations would prevent the worst
> corruption, but `reapOrphanedRuns` would not. **Horizontal scaling is not currently possible.**

---

## 7. Agents and adapters

An agent row carries `adapter_type`, `adapter_config` jsonb, `runtime_config` jsonb,
`permissions` jsonb, `reports_to` self-FK (the org chart), `default_environment_id`, `role`
and `status`.

The adapter contract is `ServerAdapterModule` in `packages/adapter-utils/src/types.ts`. Only
`type`, `execute` and `testEnvironment` are required; everything else (skills sync, session codec,
model listing, config schema, hire hooks, quota windows) is optional. `getConfigSchema()` lets an
external adapter contribute a configuration form without shipping React.

The registry (`server/src/adapters/registry.ts`) is a **mutable map** supporting runtime
register/unregister. Note that `getServerAdapter()` **silently falls back to the process adapter**
for unknown types, while `requireServerAdapter()` throws — both exist.

Invocation path: `heartbeatService.executeRun(runId)` → `claimQueuedRun` → resolve
workspace/environment/secrets/skills → `getServerAdapter(agent.adapterType)` → `adapter.execute(...)`
→ persist usage/cost/session, release locks.

> There are **two unrelated plugin systems**. "Adapter plugins" persist to a JSON file at
> `~/.paperclip/adapter-plugins.json` with their own loader. The real plugin system (§9) uses the
> `plugins` table, worker processes, capabilities and DB namespaces. They share almost nothing.

---

## 8. Cross-cutting: audit, events, approvals, storage

### Audit
`activity_log` is the audit log: `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`,
`agent_id`, `run_id`, `details` jsonb, `created_at`. Single write path `logActivity()`, which
sanitises details and redacts usernames before insert. Indexed on `(company_id, created_at)`,
`(run_id)`, `(entity_type, entity_id)`.

Gaps: no `updated_at`, no IP/user-agent, no before/after diff, no immutability constraint, no
retention policy, no SQL-level `actor_type` CHECK.

### Events
Three mechanisms, no outbox and no durable queue:

1. `activity_log` — the durable one.
2. An in-process `EventEmitter` keyed by company for UI live updates. **Volatile and unreplayable**;
   event IDs are a process-local counter that resets on restart.
3. The **plugin event bus**, fed from `logActivity`. 32 closed event types; supports trailing-`*`
   prefix wildcards and filters on `projectId`/`companyId`/`agentId`. Plugins emit namespaced
   `plugin.<pluginId>.<name>`.

> The activity→plugin-event mapping is **lossy**: an exact name match against the 32 types, or a
> hand-maintained 13-entry alias table. Any other action fires no plugin event. Core code has no
> subscribe API at all.

### Approvals
`approvals` is generic in shape (`type`, `payload` jsonb, `status`, `decided_by_user_id`), linked
to work by `issue_approvals` and threaded by `approval_comments`. `resolveApproval` transitions only
from `{pending, revision_requested}` via a guarded UPDATE and is idempotent.

But `APPROVAL_TYPES` is a **closed set of four** — `hire_agent`, `approve_ceo_strategy`,
`budget_override_required`, `request_board_approval` — and **there is no generic "this action
requires approval" interceptor**. Each type is hand-wired.

The gates that actually exist: hire approval (default **off**), budget hard stop (default **on**,
enforced in `claimQueuedRun`), subtree pause holds, and assignment policy evaluation.

### Storage
`server/src/storage/` is a complete provider-abstracted blob layer and **must not be duplicated**:

- `StorageService.putFile({ companyId, namespace, originalFilename, contentType, body })` computes
  sha256 and builds a key `{companyId}/{namespace}/{YYYY}/{MM}/{DD}/{uuid}-{stem}{ext}`.
- `ensureCompanyPrefix()` throws `forbidden` if an object key does not start with `{companyId}/` —
  this is the tenancy boundary for blobs.
- Providers: `local_disk` (atomic temp+rename, traversal guards) and `s3` (supports custom endpoint,
  prefix and path-style, so MinIO/R2 work).
- Backed by the `assets` table and streamed by `GET /api/assets/:assetId/content`.
- `server/src/attachment-types.ts` allowlists png/jpeg/webp/gif/**pdf**/markdown/plain/json/csv/html
  by default and is extensible via `PAPERCLIP_ALLOWED_ATTACHMENT_TYPES`. SVG is sanitised through
  DOMPurify+JSDOM before storage.

> **Naming trap.** Core `documents` / `document_revisions` are **markdown-in-Postgres** wiki
> documents (`latest_body` is `text`), not binary files. Anything file-based belongs on `assets`.

---

## 9. The plugin system — the primary extension surface

Specified in `doc/plugins/PLUGIN_SPEC.md`; practical guidance in `PLUGIN_AUTHORING_GUIDE.md` and
`LOCAL_PLUGIN_DEVELOPMENT.md`. Reference implementation: `packages/plugins/plugin-llm-wiki`.

Plugins run **out of process** — a forked child speaking JSON-RPC 2.0 over stdio, with exponential
backoff restart, a 30s default RPC timeout (15min max), and double-sided capability enforcement
(host-side `assertOperation()` plus SDK-side `createHostClientHandlers`).

### What a plugin can add

| Surface | Manifest key | Notes |
|---|---|---|
| Tables | `database` | Own Postgres schema `plugin_<slug>_<hash>` + checksummed `plugin_migrations` ledger |
| REST endpoints | `apiRoutes[]` | **JSON-only**, mounted at `/api/plugins/:pluginId/api/*`, cannot shadow core paths |
| Agent tools | `tools[]` | Namespaced `<pluginId>:<tool>` |
| UI | `ui.slots` + `entrypoints.ui` | `page`, `routeSidebar`, `sidebar`, `sidebarPanel`, `detailTab`, `dashboardWidget`, `settingsPage`, and more |
| Scheduled work | `jobs[]` / `routines[]` | Managed routines are preferred — visible, budgeted, auditable |
| Inbound webhooks | `webhooks[]` | `POST /api/plugins/:pluginId/webhooks/:endpointKey` |
| Managed resources | `agents[]`, `projects[]`, `routines[]`, `skills[]` | Become **first-class Paperclip records**, not private plugin state |
| Environment drivers | `environmentDrivers[]` | |
| Local folders | `localFolders[]` | Declared, access-controlled host directories |

### Database constraints (hard, and they shape any plugin schema)

Verified in `server/src/services/plugin-database.ts`:

- The namespace is derived as `plugin_<slug>_<hash>` and **there is no placeholder substitution** —
  migration SQL must hardcode the literal schema name.
- **Migrations are additive-only.** `DROP` and `TRUNCATE` are rejected outright. No `CREATE EXTENSION`,
  no triggers, no functions, no `GRANT`/`REVOKE`, no `COPY`, no `DO $$`.
- Migrations may `REFERENCES public.<table>` for FKs and read-only views, but only for whitelisted
  tables and only in `from`/`join`/`references` position.
- `ctx.db.query()`: exactly one statement, must start `select ` or `with `, and must contain no
  mutation or DDL keyword anywhere.
- `ctx.db.execute()`: exactly one statement, must start `insert into` / `update` / `delete from`,
  and **cannot reference `public` or any other schema at all**.
- **There is no transaction API.** Multi-row operations cannot currently be made atomic.
- `PLUGIN_DATABASE_CORE_READ_TABLES` is the whitelist: companies, projects, goals, agents, issues,
  issue_documents, issue_relations, issue_comments, heartbeat_runs, cost_events, approvals,
  issue_approvals, budget_incidents.

### Trust model — read this before assuming isolation
- Plugin workers and plugin UI are **trusted code**.
- Plugin UI runs as **same-origin JavaScript** inside the main app. Manifest capabilities gate
  worker-side host RPC only — they do **not** stop plugin UI from calling ordinary Paperclip HTTP APIs.
- `ctx.assets` is **not supported** in the current runtime — a worker cannot read or write file bytes.
- Runtime install assumes a persistent writable filesystem and an available `npm`. There is no shared
  artifact store, so dynamic install is **not cloud-ready for multi-node deployments**.

### Where an ERP permission boundary can actually be enforced
`PluginApiRequestInput` (`packages/plugins/sdk/src/define-plugin.ts`) delivers
`{ actor: { actorType, actorId, agentId, userId, runId }, companyId, params, query, body, headers }`
to `onApiRequest`. This is the enforcement point.

It matters because the MCP tool `paperclipApiRequest` lets any agent call **any** REST path — so
curating an agent's tool list is *not* a security boundary. Permissions must be checked server-side
against `actor`, never inferred from which tools an agent was given.

---

## 10. Skills and MCP

**MCP** (`packages/mcp-server`) is a thin stdio proxy over the REST API — it never touches the
database. Tools are declared as `makeTool(name, description, zodSchema, execute)` reusing schemas
from `@paperclipai/shared`, so MCP and REST validate identically. Authorization is entirely
delegated to the server via `Authorization: Bearer`. ~41 `paperclip*` tools, including the
escape hatch `paperclipApiRequest`.

**Skills** exist in three places: the bundled/optional catalog in `packages/skills-catalog`
(content-hashed, trust-levelled, compiled to `generated/catalog.json`); repo skills under `skills/`
and `.agents/skills/`; and per-company installed skills in the `company_skills` table (markdown
stored in the DB). At runtime the server resolves `listRuntimeSkillEntries(companyId)`, injects
`paperclipRuntimeSkills` into the adapter config, and adapters either read it directly or
materialise it to disk when `requiresMaterializedRuntimeSkills` is set.

---

## 11. Verification and CI

| Purpose | Command |
|---|---|
| Fastest inner loop | `pnpm exec vitest run <path/to/file.test.ts>` |
| Scoped typecheck | `pnpm --filter @paperclipai/<pkg> typecheck` |
| Full pre-handoff gate | `pnpm -r typecheck && pnpm test:run && pnpm build` |
| After a schema change | `pnpm db:generate && pnpm -r typecheck` |
| Browser suites (opt-in) | `pnpm test:e2e`, `pnpm test:release-smoke` |

- **There is no ESLint, Prettier or Biome in this repo**, and no `lint`/`format` script. Static
  analysis is TypeScript strict plus the `scripts/check-*` guards.
- Server tests are fully serialized (`maxWorkers: 1`, `pool: "forks"`). Tests needing a real
  database **must** use `server/src/__tests__/helpers/embedded-postgres.ts` — never construct
  `embedded-postgres` directly.
- UI tests default to a `node` environment; DOM tests opt in with `// @vitest-environment jsdom` on
  line 1. There is no `@testing-library/react`.
- CI (`.github/workflows/pr.yml`) **blocks any PR that touches `pnpm-lock.yaml`**; the
  `refresh-lockfile.yml` workflow owns it.
- Root `vitest.config.ts` `projects` and `scripts/run-vitest-stable.mjs` `nonServerProjects` are
  **hardcoded lists**. Packages absent from them are never tested in CI — which is currently true of
  every plugin package.

---

## 12. Observed technical debt

Recorded because it constrains where new work can safely go, not as criticism.

1. **God files.** `services/heartbeat.ts` ~10.3k lines, `routes/issues.ts` ~6.2k,
   `services/issues.ts` ~6.1k, `services/company-portability.ts` ~4.7k.
2. **Single-process assumption** throughout the execution engine (§6).
3. **No RLS, no repository layer**; tenant isolation is 100% convention (§4).
4. **Central `decide()` is barely adopted** — ~6 non-test call sites.
5. **Migration machinery guesses.** `reconcilePendingMigrationHistory` regex-matches SQL against
   `information_schema` to infer whether a migration already ran.
6. **Inconsistent FK `onDelete`** between older and newer tables.
7. **Plugin event mapping is a hand-maintained alias table** — new core actions silently emit nothing.
8. **Live events are unreplayable** (process-local counter).
9. **Two unrelated plugin systems** (adapter plugins vs. the real plugin runtime).
10. **`getServerAdapter` silently falls back** to the process adapter for unknown types.
11. **Query params are never zod-validated**, despite zod being used for bodies.
12. **32-bit ceilings** on `companies.budget_monthly_cents`, `spent_monthly_cents`,
    `attachment_max_bytes` (`integer` columns).
13. **`cloud_tenant` auto-provisions** users, instance-admin roles and companies from a single
    shared-secret header — total blast radius if that secret leaks.
14. **`adapter-plugin.md` at the repo root is an AI agent work-log**, not a specification. Debris.
15. **`AGENTS.md` is stale on the database** — it says PGlite; the code uses `embedded-postgres`.
    `AGENTS.md` also has two `## 11.` headings and a fork-specific section for a different fork.
16. **Root `tsconfig.json` references `./packages/adapters/droid-local`, which does not exist** and
    was never committed; `droid_local` is an externally installed npm adapter.

---

## 13. Conclusions for the ERP programme

1. **The plugin system is the correct ERP boundary.** It provides schema isolation, migrations,
   API routes, a full-page UI with its own sidebar, agent tools, managed agents and event
   subscriptions — without touching core.
2. **Reuse, do not rebuild**: blob storage and `assets`, `issues`, `approvals`, `activity_log`,
   `agents`, `projects`, and the heartbeat engine.
3. **The ERP must own its own permission model.** Core `PERMISSION_KEYS` is closed and
   organisational; ERP resource permissions have no home in core.
4. **Enforce permissions server-side on `actor`**, never via tool curation (`paperclipApiRequest`).
5. **Three plugin-host gaps must be closed** for a document-centric ERP, each a generic improvement:
   `assets` in the core read whitelist, a generic company asset upload route, and a
   namespace-scoped transaction API.
6. **Horizontal scaling is a separate core workstream** and should not be conflated with
   multi-company tenancy, which already works.
