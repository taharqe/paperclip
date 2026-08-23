import { ERP_ROLES, type ErpRole } from "../constants.js";

/**
 * The ERP permission layer.
 *
 * Core's `PERMISSION_KEYS` is a closed 8-value set covering organisational
 * administration (invite users, create agents, assign tasks). It does not model
 * documents, revisions or engineering values, so the ERP owns its own layer.
 *
 * This is enforced **server-side in `onApiRequest`, against the request actor** -
 * never by curating which tools an agent was given. The `paperclipApiRequest`
 * MCP tool lets any agent call any REST path, so tool curation is not a security
 * boundary. See CLAUDE.md section 5.
 *
 * Pure: no I/O, no `ctx`. Grants are passed in.
 */

export type ErpPrincipalKind = "user" | "agent";

export const ERP_ACTIONS = [
  "document.read",
  "document.register",
  "revision.add",
  "revision.transition",
  "asset.verify",
  "extraction.submit",
  "value.review",
  "diff.compute",
  "diff.explain",
  "provenance.read",
  "release.prepare",
  "release.link",
  "grant.manage",
] as const;
export type ErpAction = (typeof ERP_ACTIONS)[number];

export interface ErpGrant {
  role: ErpRole;
  /** When set, the grant applies only to documents in this project. */
  projectId?: string | null;
}

export interface ErpAccessRequest {
  principalKind: ErpPrincipalKind;
  action: ErpAction;
  /** Project the target document belongs to, if any. */
  projectId?: string | null;
  grants: readonly ErpGrant[];
}

export type ErpAccessDecision =
  | { allowed: true; role: ErpRole }
  | { allowed: false; reason: ErpDenialReason; explanation: string };

export type ErpDenialReason =
  | "no_grant"
  | "role_lacks_action"
  | "out_of_project_scope"
  | "requires_human_actor";

/**
 * Actions a non-human actor may never perform, whatever role it holds.
 *
 * Mirrors the hard rule in `lifecycle.ts`: an agent can prepare and analyse,
 * but a human authorises. `revision.transition` is deliberately absent - agents
 * do need to move revisions toward review; the lifecycle machine is what stops
 * them reaching APPROVED or RELEASED.
 */
const HUMAN_ONLY_ACTIONS: ReadonlySet<ErpAction> = new Set<ErpAction>([
  "release.prepare",
  "release.link",
  "grant.manage",
]);

const ROLE_ACTIONS: Readonly<Record<ErpRole, readonly ErpAction[]>> = {
  erp_viewer: ["document.read", "provenance.read"],
  erp_engineer: [
    "document.read",
    "provenance.read",
    "asset.verify",
    "extraction.submit",
    "diff.compute",
    "diff.explain",
    "value.review",
    "revision.transition",
  ],
  erp_doc_controller: [
    "document.read",
    "provenance.read",
    "document.register",
    "revision.add",
    "revision.transition",
    "asset.verify",
    "value.review",
    "diff.compute",
    "release.prepare",
    "release.link",
  ],
  erp_approver: [
    "document.read",
    "provenance.read",
    "value.review",
    "release.prepare",
    "release.link",
  ],
  erp_admin: [...ERP_ACTIONS],
};

export function isErpRole(value: string): value is ErpRole {
  return (ERP_ROLES as readonly string[]).includes(value);
}

/** True when a grant applies to the target project (an unscoped grant applies everywhere). */
function grantCoversProject(grant: ErpGrant, projectId: string | null | undefined): boolean {
  if (!grant.projectId) return true;
  return Boolean(projectId) && grant.projectId === projectId;
}

/**
 * Decide whether a principal may perform an ERP action.
 *
 * The human-only check runs before any grant lookup, so no role configuration
 * can route an agent around it.
 */
export function evaluateErpAccess(request: ErpAccessRequest): ErpAccessDecision {
  const { principalKind, action, projectId, grants } = request;

  if (principalKind !== "user" && HUMAN_ONLY_ACTIONS.has(action)) {
    return {
      allowed: false,
      reason: "requires_human_actor",
      explanation: `${action} requires a human actor; a ${principalKind} may not perform it.`,
    };
  }

  const usable = grants.filter((grant) => isErpRole(grant.role));
  if (usable.length === 0) {
    return {
      allowed: false,
      reason: "no_grant",
      explanation: "Principal holds no ERP role in this company.",
    };
  }

  const roleCapable = usable.filter((grant) => ROLE_ACTIONS[grant.role].includes(action));
  if (roleCapable.length === 0) {
    return {
      allowed: false,
      reason: "role_lacks_action",
      explanation: `No held role permits ${action}. Held: ${usable
        .map((grant) => grant.role)
        .join(", ")}.`,
    };
  }

  const inScope = roleCapable.find((grant) => grantCoversProject(grant, projectId));
  if (!inScope) {
    return {
      allowed: false,
      reason: "out_of_project_scope",
      explanation: `Held roles permit ${action} but only within other projects.`,
    };
  }

  return { allowed: true, role: inScope.role };
}

/** True when the principal may drive a revision to APPROVED or RELEASED. */
export function hasReleaseGrant(
  principalKind: ErpPrincipalKind,
  projectId: string | null | undefined,
  grants: readonly ErpGrant[],
): boolean {
  if (principalKind !== "user") return false;
  return grants.some(
    (grant) =>
      (grant.role === "erp_approver" ||
        grant.role === "erp_doc_controller" ||
        grant.role === "erp_admin") &&
      grantCoversProject(grant, projectId),
  );
}

/** Actions a role permits. Exported so the UI can hide controls it cannot use. */
export function actionsForRole(role: ErpRole): readonly ErpAction[] {
  return ROLE_ACTIONS[role];
}
