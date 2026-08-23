# ADR-0003 — Accept additive-only plugin migrations for now

Status: Accepted (revisit before slice 3)
Date: 2026-08-23

## Context

`validatePluginMigrationStatement` in `server/src/services/plugin-database.ts` rejects any migration
statement beginning with `DROP` or `TRUNCATE`, with the message *"Destructive plugin migrations are
not allowed in Phase 1"*. `CREATE EXTENSION`, triggers, functions, `GRANT`/`REVOKE` and `DO $$`
blocks are also banned.

A long-lived ERP schema will eventually need to drop a column, rename a table, or remove an index.
Under the current rules it cannot.

## Options

1. **Accept additive-only** for now; design the slice-1 schema conservatively.
2. **Relax the validator immediately** behind an explicit manifest opt-in
   (e.g. `database.allowDestructiveMigrations: true`), scoped strictly to the plugin's own namespace.
3. **Work around it** by creating replacement tables and leaving dead ones behind forever.

## Decision

**Option 1 for slice 1.** Do not touch the validator yet. Design the ERP schema so that additive
evolution is sufficient: prefer nullable columns over reshaping, keep jsonb for genuinely
open-ended attributes, and avoid premature normalisation that would later need undoing.

Revisit before slice 3 (Engineering Automation), by which point the schema will have stabilised
enough to know what actually needs dropping.

## Rationale

- The constraint is not blocking for slice 1. Nothing in the document-control schema requires a
  destructive migration.
- Relaxing a security-relevant validator is a change that deserves its own focused work with its own
  tests — not something to bundle into the first ERP slice.
- Option 3 accumulates permanent debt and is worse than either alternative.

## Consequences

- The slice-1 schema must be designed with more care than usual, because mistakes are expensive
  to correct.
- Dead columns may accumulate until Option 2 is implemented.
- When Option 2 is taken up it must remain namespace-scoped: a plugin must never be able to drop
  anything in `public`.

## Reversibility

**High.** This defers a decision rather than foreclosing it.
