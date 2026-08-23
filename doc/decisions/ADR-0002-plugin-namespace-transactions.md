# ADR-0002 — Add a namespace-scoped transaction API to the plugin host

Status: Accepted
Date: 2026-08-23

## Context

`server/src/services/plugin-database.ts` exposes exactly two runtime SQL entry points to a plugin
worker, both restricted to a single statement:

- `ctx.db.query()` — must start `select ` or `with `, no mutation or DDL keywords anywhere.
- `ctx.db.execute()` — must start `insert into` / `update` / `delete from`, cannot reference `public`
  or any non-plugin schema.

**There is no transaction API.** Data-modifying CTEs (`WITH ... INSERT`) are rejected because
`execute` must *begin* with an insert/update/delete keyword.

The ERP has genuine multi-row invariants. Recording an extraction means writing N
`erp_extracted_values` rows and transitioning the parent `erp_document_revisions` row to
`REQUIRES_REVIEW`. A torn write leaves a revision whose status disagrees with its data — precisely
the kind of silent corruption an ERP must not have (master prompt §27: transactions, constraints,
data integrity).

## Options

1. **Saga / idempotent status machine.** Design every operation as a sequence of single-statement
   writes with idempotency keys and a reconciliation pass.
2. **Add `ctx.db.transaction(statements[])`** to the plugin host.
3. **Give the ERP direct core database access**, bypassing the plugin namespace.

## Decision

**Option 2.** Add a namespace-scoped transaction RPC that accepts an ordered list of statements,
validates every one with the **existing** `validatePluginRuntimeExecute`, and executes them inside a
single `db.transaction`.

## Rationale

- It is small and low-risk. It mirrors the existing `execute()` implementation, reuses the existing
  validator unchanged, and `plugin-database.ts` already uses `db.transaction` defensively when
  applying migrations. No new validator, no new capability (`database.namespace.write` already
  covers it), no new trust boundary — every statement is subject to exactly the same restrictions
  as a single `execute()` call.
- Option 1 is real engineering cost paid on **every** ERP operation forever, and it produces a system
  that is harder to reason about and easier to get wrong, in exchange for avoiding ~25 lines of core.
  That is a bad trade.
- Option 3 destroys the entire benefit of ADR-0001 and was not seriously considered.
- It is a **generic** plugin-system improvement. Any plugin with multi-row invariants needs it; it
  contains no ERP vocabulary.

## Consequences

- Core change to `server/src/services/plugin-database.ts`, RPC wiring in `plugin-host-services.ts`,
  and type/protocol additions in the plugin SDK. Ships with tests using a real embedded Postgres.
- The plugin SDK's published API v1 surface grows by one method — additive, non-breaking.
- Statement-count and payload limits should be applied so a plugin cannot hold a long transaction
  open and exhaust the connection pool.

## Reversibility

**High.** It is additive. Removing it would only break plugins that adopted it.
