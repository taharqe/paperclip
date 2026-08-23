# AI Industrial ERP — Target Architecture and Slice Roadmap

Date: 2026-08-23
Status: Accepted; slice 1 in progress

Companion documents:
- `doc/architecture/paperclip-analysis.md` — how Paperclip actually works
- `doc/decisions/ADR-0001-erp-extension-boundary.md` — why the ERP is a plugin
- `doc/decisions/ADR-0002-plugin-namespace-transactions.md` — why the host gains a transaction API
- `doc/decisions/ADR-0003-additive-only-plugin-migrations.md` — why we accept additive-only migrations
- `doc/state/current-milestone.md` — the active milestone and its exit criteria

---

## 1. Product thesis

An ERP designed around AI agents and industrial workflows:

```
Human → ERP interface → AI orchestration → Agents → Tools
     → Business systems → Industrial data → Human approval
```

The ERP remains the source of truth. Paperclip remains the orchestration/control plane. Humans
remain responsible for controlled decisions. The target is not "ChatGPT for ERP" — it is an ERP
that can operate large parts of itself, under policy and budget, with every action auditable.

Initial focus: engineering and industrial project workflows.

## 2. Layering

```
┌─────────────────────────────────────────────────────────────┐
│  AI INDUSTRIAL ERP   packages/plugins/plugin-erp-*           │
│  own PG namespace · own migrations · own API · own UI shell  │
│  own resource-level permission model                         │
├─────────────────────────────────────────────────────────────┤
│  PLUGIN HOST BOUNDARY                                        │
│  capabilities · company scoping · namespace SQL validation   │
│  out-of-process worker isolation                             │
├─────────────────────────────────────────────────────────────┤
│  PAPERCLIP CORE                                              │
│  agents · issues · heartbeats · approvals · budgets          │
│  activity_log · assets/storage · projects · goals            │
└─────────────────────────────────────────────────────────────┘
```

**Placement rule** — ask in order, first match wins:
1. Core already has it → reuse.
2. Generic plugin-system gap → smallest possible core fix, no ERP vocabulary, with tests.
3. ERP business logic → `plugin-erp-core`.
4. Industrial-domain logic → `plugin-erp-industrial`.
5. External system → integration module behind an interface.

## 3. Package split

| Package | Scope | Slice |
|---|---|---|
| `plugin-erp-core` | Document register, revisions, provenance, ERP permissions, ERP agents, ERP UI shell | 1 |
| `plugin-erp-industrial` | Equipment/tag register, instruments, specifications, calculations | 2–3 |
| `plugin-erp-supply` | Suppliers, RFQs, purchase requests, inventory | 4 |

Bounded contexts stay separate. There is no single ERP model containing everything.

## 4. Core primitives that are reused, not rebuilt

| ERP need | Paperclip primitive |
|---|---|
| Binary document storage | `server/src/storage/` + `assets` (sha256, company-prefixed keys, local_disk/S3) |
| Tasks and review work | `issues` (single assignee, atomic checkout, `plugin:` origin) |
| Human decisions | `approvals` (+ `issue_approvals`) |
| Audit | `activity_log` via `logActivity()` |
| Agent execution | heartbeats, budgets, adapters |
| Project container | `projects`, `goals` |

## 5. Enumerated core changes

Each is a **generic plugin-host improvement**, not ERP logic. See ADR-0002 for the reasoning on H3.

| # | Change | Rationale |
|---|---|---|
| H1 | Add `assets` to `PLUGIN_DATABASE_CORE_READ_TABLES` | An ERP document row must be able to FK to `public.assets(id)` |
| ~~H2~~ | ~~Generic company asset upload route~~ **NOT NEEDED** | `POST /api/companies/:companyId/assets/images` is misleadingly named: it is already a general company-scoped upload gated by the process content-type allowlist, which includes `application/pdf`. Verified by test (`server/src/__tests__/assets.test.ts`). The ERP reuses it with `namespace: "erp/documents"`. |
| H3 | `ctx.db.transaction([...])` namespace-scoped transaction RPC | Multi-row ERP invariants cannot otherwise be atomic |
| H4 | *(deferred)* Destructive plugin migrations behind manifest opt-in | See ADR-0003 |

Deliberately **not** done: adding ERP values to the closed core `APPROVAL_TYPES` enum. The ERP owns
its release state machine; a core `approvals` row of the existing `request_board_approval` type,
discriminated by `payload`, records the human decision.

## 6. Slice roadmap

| Slice | Delivers | Proves |
|---|---|---|
| **1. Document Control + Provenance** | Document register on core `assets`; revisions A/B/C; deterministic revision diff; extracted engineering values with full provenance; DRAFT→AI_GENERATED→REQUIRES_REVIEW→APPROVED/REJECTED→RELEASED; three ERP agents; ERP UI shell; audit | "Where did this value come from?" is answerable, and AI never produces approved engineering information |
| **2. Equipment / Tag Register** | Asset/Equipment/Instrument/Valve with tag numbers, lifecycle, revision, relationships; extracted values bind to equipment; missing-data detection | The industrial data model and the extraction→entity link |
| **3. Engineering Automation** | Specification comparison, unit conversion, deterministic calculation engine, change detection, report and checklist generation | LLM interprets, deterministic engine calculates |
| **4. Procurement** | Suppliers, RFQs, purchase requests, supplier documents, inventory | Cross-context workflow |
| **5. Quality + Maintenance** | Inspections, non-conformities, corrective actions, work orders | Operations coverage |
| **6. Advanced AI** | Multi-agent workflows, enterprise search, agent memory, AI command centre | Compound autonomy |
| **7. Enterprise platform** | Multi-tenancy hardening, integrations, analytics, plugin marketplace | Productisation |

## 7. Non-negotiable invariants

1. **Provenance.** Every engineering value records its source document, page/locator, revision,
   extraction method, model, confidence and review status. Never lose provenance.
2. **Determinism.** Diffs, calculations and unit conversions are plain TypeScript with unit tests.
   An LLM may explain a computed result; it may never produce one.
3. **Human-in-the-loop.** Agent-written data enters as `AI_GENERATED`. Only a human actor holding
   the release grant reaches `APPROVED`/`RELEASED`.
4. **Least privilege, enforced server-side.** ERP permissions are checked in `onApiRequest` against
   the request `actor` — never inferred from an agent's tool list, which `paperclipApiRequest`
   bypasses entirely.
5. **Company scoping.** Every ERP table carries `company_id`; every query filters on it, including
   single-row reads. Core has no RLS.
6. **Auditability.** Every mutation writes an `activity_log` entry.
7. **No safety claims.** Never assert "safe", "compliant", "certified" or "approved" without
   explicit evidence and human authorisation.
8. **No fake features.** Unimplemented surfaces are labelled `NOT IMPLEMENTED`, never stubbed
   behind polished UI.

## 8. Known constraints and open risks

| Risk | Status |
|---|---|
| Paperclip cannot run more than one API replica (in-memory locks, no scheduler leader election) | Tracked as a separate core workstream. Cloud path for now is one vertically-scaled API node + external Postgres + S3, which works today. Multi-*company* tenancy already works. |
| Plugin runtime install is not cloud-ready (needs writable FS + npm, no artifact store) | Sidestepped by bundling the ERP plugin into the Docker image |
| Additive-only plugin migrations | ADR-0003 |
| Plugin UI is same-origin trusted code, not sandboxed | Acceptable for first-party only |
| Tenant isolation is convention, not RLS | ERP must be disciplined; cross-tenant tests required |

Full risk register and pre-existing defects: `doc/state/blockers.md`, `doc/state/known-issues.md`.
