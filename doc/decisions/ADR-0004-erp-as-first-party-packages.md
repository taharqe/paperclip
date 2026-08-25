# ADR-0004 — The ERP is first-party packages, not a plugin

Status: Accepted (supersedes ADR-0001)
Date: 2026-08-23

## Context

ADR-0001 chose to build the Industrial ERP as a bundled first-party Paperclip plugin. That
decision was made before writing any ERP code. We then built on it: schema, three pure domain
modules, a manifest, and a SQL layer — roughly 1,668 lines with 80 tests. This ADR records what
that measured, and reverses the decision.

## What the plugin boundary actually delivered

It held its central promise. Measured on the working branch:

- **~110 lines** of core production code changed, across 11 files.
- **Zero ERP vocabulary in core** — verified by grep. The only mentions were four package-name
  registration lines (Dockerfile, vitest projects, test runner, bundled badge).
- Every core change was a *generic* plugin-system improvement: namespace transactions, an
  `assets` read whitelist, exporting the SQL splitter for pre-flight testing.

Schema isolation was real: ERP tables physically could not collide with control-plane tables.

## What it cost

Eight distinct constraints, each needing a workaround. One compounds:

**`ctx.db` is untyped.** The ERP's data access had grown to 446 lines of raw SQL strings. The
host validator is regex-based and schema-blind, so `select nonexistent_column from ns.erp_documents`
passes validation and fails at runtime. Drizzle would make that a compile error. The cost scales
with every table added.

The others: hash-derived namespace hardcoded into migration SQL (94 lines of machinery and tests
to make it safe); additive-only migrations, so no column can ever be dropped; agents cannot invoke
plugin tools, making the declared `tools[]` dead metadata; JSON-only routes, so file upload must
detour through core; no `ctx.assets`, so the worker cannot read bytes; plugin UI is same-origin
trusted, making part of the isolation benefit illusory; and host fragility — an apostrophe in a
SQL comment breaks the validator.

## The deciding argument

The plugin system is designed for **optional, third-party extensions**. On a hard fork where the
ERP is the product, it is neither. Making the application a plugin of the library is an inversion,
and the constraints above are where that inversion bills you.

The scope confirmed this: the ERP is heading to procurement, inventory, quality, maintenance and
finance — hundreds of tables.

## Options

1. Stay, and lift the two constraints that bite (destructive migrations, agent tool dispatch).
   Leaves the untyped-SQL problem unsolved.
2. **Move to first-party packages.**
3. Move, but behind one thin module-registry seam so layering stays legible. *(Chosen.)*
4. Separate service. Rejected: two deployments, two auth systems, cross-service consistency, and
   agents needing credentials for both — real cost for isolation this fork does not need.

## Decision

**Option 3.** The ERP lives in `packages/erp-*`, mounted through a single module registry rather
than wiring spread through `app.ts` and the UI router. Its tables live in
`packages/db/src/schema/erp/`, exported by one line from `schema/index.ts`.

The schema sits in `packages/db` deliberately: placing it in `erp-core` would make `db` depend on
`erp-core` for drizzle-kit while `erp-core` depends on `db` for company foreign keys. Keeping it in
`db` preserves one migration timeline and one drizzle config with no cycle.

## Consequences

**Gained**: compile-checked queries, native transactions, native multipart upload, native MCP
agent tools, unrestricted migrations, the real design system for UI.

**Deleted**: 446 lines of raw SQL, 94 lines of namespace machinery, the manifest route
indirection, and a hardcoded schema hash that was a permanent footgun.

**Lost**: structural schema isolation and unit-deletability. Mitigated by prefixing every table
`erp_`, keeping the schema in its own directory, and enforcing the invariants that the sandbox
used to guarantee — company scoping, cascade, index leading, no `assets` foreign key — as tests in
`packages/erp-core/tests/schema.spec.ts`.

**Kept anyway**: the Phase B host improvements (namespace transactions, `assets` read whitelist)
remain in core. They are generic, tested, and useful to any plugin, even though the ERP no longer
needs them.

**Cost of the move**: about half a day, because the pure domain modules were portable — all 34 of
their tests passed unchanged after the move.

## Reversibility

**Low, and deliberately so.** Moving back to a plugin would mean re-deriving a namespace,
re-writing typed queries as strings, and re-introducing the workarounds. This decision is meant to
be final for the life of the product.

## Note on ADR-0001

ADR-0001 was not wrong on the evidence available then, and its central discipline — no domain
logic in core, reuse core primitives, enforce permissions server-side — carries forward unchanged.
What changed is that building on the boundary revealed a cost that could not be seen from outside it.
