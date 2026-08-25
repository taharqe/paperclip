# ADR-0001 — The Industrial ERP is a Paperclip plugin, not core

Status: **Superseded by ADR-0004** (2026-08-23)
Date: 2026-08-23

> Superseded after building on it. The boundary held its promise - zero ERP vocabulary reached
> core - but charged for that isolation through untyped SQL, additive-only migrations, and
> board-only agent tool dispatch. See `ADR-0004-erp-as-first-party-packages.md`.

## Context

We are building an AI Industrial ERP on a hard fork of Paperclip. The ERP needs its own entities
(documents, engineering data, equipment), its own APIs, its own UI, its own agents and its own
resource-level permission model. The question is where that code lives.

Paperclip already ships a plugin system that is substantially implemented, not aspirational:
28 `plugin-*` service modules, 13 plugin tables, an out-of-process worker runtime with JSON-RPC and
capability enforcement, and a working first-party reference plugin (`packages/plugins/plugin-llm-wiki`)
that adds database tables, API routes and UI pages.

The upstream project's own `ROADMAP.md` states it intends to *"keep a thin core and rich edges"* and
that *"the best path is often the plugin system"*. `CONTRIBUTING.md` says uncoordinated core feature
PRs may be closed and to prefer the plugin system.

## Options

1. **First-party core packages** — `packages/erp-*` with tables in `packages/db/src/schema`, routes in
   `server/src/routes`, pages in `ui/src/pages`.
2. **Pure plugin, zero core changes** — everything inside the plugin sandbox as it exists today.
3. **Plugin plus a minimal, enumerated set of generic plugin-host fixes in core.**

## Decision

**Option 3.** The ERP domain ships as bundled first-party plugin packages under
`packages/plugins/plugin-erp-*`. Separately, a small enumerated set of gaps in the *plugin host* are
fixed in core — each one a generic improvement to Paperclip's plugin system carrying no ERP
vocabulary, each with tests, each independently revertible.

## Rationale

- The plugin boundary gives schema isolation, a checksummed migration ledger, company-scoped API
  routes, a full-page UI with its own sidebar, namespaced agent tools, managed agents/routines/skills
  and event subscriptions — the entire ERP surface — without touching core.
- It makes "do not contaminate core with domain logic" a structural property rather than a matter of
  discipline. Core physically cannot import ERP code.
- Option 1 would mean hundreds of ERP tables, routes and pages inside a control plane whose stated
  design goal is to stay thin, and would entangle ERP work with the highest-blast-radius files in
  the repo (`heartbeat.ts`, `issues.ts`, `auth.ts`).
- Option 2 was rejected because three host gaps genuinely block a document-centric ERP: `assets` is
  absent from the plugin core-read whitelist, there is no generic company-scoped file upload route,
  and there is no transaction API — so multi-row ERP writes could not be made atomic.
- Because this is a hard fork, we are not constrained by upstream merge risk; but keeping core
  changes generic and small is still the right engineering discipline, and keeps the option of
  contributing them upstream.

## Consequences

**Positive**
- ERP schema lives in its own Postgres namespace and cannot corrupt core tables.
- ERP code is deletable and replaceable as a unit.
- Core reuse is forced by construction — storage, issues, approvals, activity log, agents, projects.

**Negative / accepted costs**
- Plugin runtime SQL is constrained: one statement per call, `execute` cannot reference `public`,
  and migrations are additive-only. The ERP schema must denormalise and evolve forward-only.
- Plugin API routes are JSON-only, so file upload must go through a core route (see H2).
- Plugin UI is same-origin trusted code, not sandboxed. Acceptable for first-party code only.
- ERP data is not visible to core's company export/import without extra work.

## Reversibility

**Moderate.** The ERP schema lives in its own namespace, so moving it into core later means a
data migration between schemas plus rewriting route/UI registration — mechanical but not trivial.
Moving *from* core *to* a plugin would be considerably harder. Starting as a plugin preserves more
optionality than starting in core.
