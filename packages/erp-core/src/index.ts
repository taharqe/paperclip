/**
 * Industrial ERP core.
 *
 * Layering:
 *
 *  - `domain/`   pure logic - deterministic diff, the review-state machine, and
 *                the ERP permission model. No I/O, no database, no LLM.
 *  - `services/` persistence and business operations over the Drizzle schema in
 *                `@paperclipai/db`.
 *  - `routes/`   HTTP surface, mounted by the module registry in the server.
 *
 * The ERP is the system of record; Paperclip remains the control plane. This
 * package never reaches into control-plane internals - it composes the public
 * primitives (assets, issues, approvals, activity log, agents, projects).
 */
export * from "./domain/index.js";
