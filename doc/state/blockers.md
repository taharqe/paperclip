# Blockers

None currently blocking Phase A or Phase B.

## Watch list (tracked, not blocking)

| # | Item | Impact |
|---|---|---|
| B1 | Paperclip cannot run more than one API replica (in-memory locks, `EventEmitter` live events, no scheduler leader election) | Caps cloud deployment at one vertically-scaled API node. A separate core workstream. |
| B2 | Plugin runtime install needs a persistent writable filesystem + `npm`; no shared artifact store | Sidestepped for M1 by bundling the ERP plugin into the Docker image rather than runtime-installing it. |
| B3 | Plugin migrations are additive-only (`DROP`/`TRUNCATE` rejected) | Slice-1 schema must be designed conservatively. Revisit before slice 3 — see ADR-0003. |
