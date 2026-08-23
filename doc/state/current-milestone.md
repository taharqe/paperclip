# Current Milestone

## M1 — Engineering Document Control + Provenance

**Goal.** An industrial company can upload a controlled engineering document, have an AI agent
extract engineering data from it with full provenance, compare it deterministically against a
previous revision, and have a human review and release it — with every step audited.

Finite and measurable. This is *not* "build the ERP".

### Done when

- [ ] `packages/plugins/plugin-erp-core` installs and activates against a running Paperclip
- [ ] A PDF can be uploaded and registered as a document revision (Rev A/B/C)
- [ ] The Engineering Agent extracts values and writes them with per-value provenance
      (source document, page, locator, revision, method, model, confidence)
- [ ] `erp_list_extracted_values` answers "where did this value come from?" for a given tag
- [ ] Revision comparison is **deterministic** — computed in TypeScript, never by an LLM
- [ ] AI-produced data can never reach `APPROVED` or `RELEASED` without a human decision
- [ ] The ERP UI is fully usable with zero AI interaction
- [ ] Every mutation writes to core `activity_log`
- [ ] Cross-tenant tests prove no ERP row leaks between companies
- [ ] `pnpm -r typecheck && pnpm test:run && pnpm build` all pass

### Explicitly out of scope for M1

Equipment/tag register, specifications, calculations, suppliers, procurement, inventory,
maintenance, quality, finance, enterprise search, agent memory. These are labelled
`NOT IMPLEMENTED` in the UI rather than stubbed.
