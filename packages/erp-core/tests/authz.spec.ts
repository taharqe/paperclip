import { describe, expect, it } from "vitest";
import { ERP_ROLES, type ErpRole } from "../src/domain/constants.js";
import {
  actionsForRole,
  ERP_ACTIONS,
  evaluateErpAccess,
  hasReleaseGrant,
  type ErpAction,
  type ErpGrant,
} from "../src/domain/authz.js";

function grants(...roles: ErpRole[]): ErpGrant[] {
  return roles.map((role) => ({ role }));
}

describe("evaluateErpAccess", () => {
  it("denies a principal with no ERP grant", () => {
    expect(
      evaluateErpAccess({ principalKind: "user", action: "document.read", grants: [] }),
    ).toMatchObject({ allowed: false, reason: "no_grant" });
  });

  it("lets every role read documents and provenance", () => {
    for (const role of ERP_ROLES) {
      for (const action of ["document.read", "provenance.read"] as ErpAction[]) {
        expect(
          evaluateErpAccess({ principalKind: "user", action, grants: grants(role) }),
          `${role} should be able to ${action}`,
        ).toMatchObject({ allowed: true });
      }
    }
  });

  it("denies actions the held role does not cover", () => {
    expect(
      evaluateErpAccess({
        principalKind: "user",
        action: "document.register",
        grants: grants("erp_viewer"),
      }),
    ).toMatchObject({ allowed: false, reason: "role_lacks_action" });

    // An engineer extracts and analyses but does not register documents.
    expect(
      evaluateErpAccess({
        principalKind: "user",
        action: "document.register",
        grants: grants("erp_engineer"),
      }),
    ).toMatchObject({ allowed: false, reason: "role_lacks_action" });
  });

  it("never lets a non-human release, link a release, or manage grants", () => {
    const humanOnly: ErpAction[] = ["release.prepare", "release.link", "grant.manage"];
    for (const action of humanOnly) {
      for (const role of ERP_ROLES) {
        // Even erp_admin. The check precedes any grant lookup.
        expect(
          evaluateErpAccess({ principalKind: "agent", action, grants: grants(role) }),
          `agent with ${role} must not ${action}`,
        ).toMatchObject({ allowed: false, reason: "requires_human_actor" });
      }
    }
  });

  it("still lets an agent do the work it is meant to do", () => {
    const agentWork: ErpAction[] = [
      "document.read",
      "provenance.read",
      "asset.verify",
      "extraction.submit",
      "diff.compute",
      "diff.explain",
      "revision.transition",
    ];
    for (const action of agentWork) {
      expect(
        evaluateErpAccess({ principalKind: "agent", action, grants: grants("erp_engineer") }),
        `engineering agent should be able to ${action}`,
      ).toMatchObject({ allowed: true });
    }
  });

  it("confines a project-scoped grant to its project", () => {
    const scoped: ErpGrant[] = [{ role: "erp_engineer", projectId: "project-a" }];

    expect(
      evaluateErpAccess({
        principalKind: "user",
        action: "extraction.submit",
        projectId: "project-a",
        grants: scoped,
      }),
    ).toMatchObject({ allowed: true });

    expect(
      evaluateErpAccess({
        principalKind: "user",
        action: "extraction.submit",
        projectId: "project-b",
        grants: scoped,
      }),
    ).toMatchObject({ allowed: false, reason: "out_of_project_scope" });

    // A document with no project is not covered by a project-scoped grant.
    expect(
      evaluateErpAccess({
        principalKind: "user",
        action: "extraction.submit",
        projectId: null,
        grants: scoped,
      }),
    ).toMatchObject({ allowed: false, reason: "out_of_project_scope" });
  });

  it("lets an unscoped grant cover every project", () => {
    for (const projectId of ["project-a", "project-b", null]) {
      expect(
        evaluateErpAccess({
          principalKind: "user",
          action: "extraction.submit",
          projectId,
          grants: grants("erp_engineer"),
        }),
      ).toMatchObject({ allowed: true });
    }
  });

  it("combines multiple grants, taking the one that permits the action in scope", () => {
    const held: ErpGrant[] = [
      { role: "erp_viewer" },
      { role: "erp_engineer", projectId: "project-a" },
    ];
    expect(
      evaluateErpAccess({
        principalKind: "user",
        action: "extraction.submit",
        projectId: "project-a",
        grants: held,
      }),
    ).toMatchObject({ allowed: true, role: "erp_engineer" });
  });

  it("ignores unknown roles rather than trusting them", () => {
    expect(
      evaluateErpAccess({
        principalKind: "user",
        action: "document.read",
        grants: [{ role: "erp_superuser" as ErpRole }],
      }),
    ).toMatchObject({ allowed: false, reason: "no_grant" });
  });

  it("gives erp_admin every action", () => {
    for (const action of ERP_ACTIONS) {
      expect(
        evaluateErpAccess({ principalKind: "user", action, grants: grants("erp_admin") }),
        `erp_admin should be able to ${action}`,
      ).toMatchObject({ allowed: true });
    }
    expect(actionsForRole("erp_admin")).toHaveLength(ERP_ACTIONS.length);
  });
});

describe("hasReleaseGrant", () => {
  it("is false for any agent, whatever role it holds", () => {
    for (const role of ERP_ROLES) {
      expect(hasReleaseGrant("agent", null, grants(role)), role).toBe(false);
    }
  });

  it("is true only for roles that may authorise a release", () => {
    expect(hasReleaseGrant("user", null, grants("erp_approver"))).toBe(true);
    expect(hasReleaseGrant("user", null, grants("erp_doc_controller"))).toBe(true);
    expect(hasReleaseGrant("user", null, grants("erp_admin"))).toBe(true);
    expect(hasReleaseGrant("user", null, grants("erp_engineer"))).toBe(false);
    expect(hasReleaseGrant("user", null, grants("erp_viewer"))).toBe(false);
  });

  it("respects project scope", () => {
    const scoped: ErpGrant[] = [{ role: "erp_approver", projectId: "project-a" }];
    expect(hasReleaseGrant("user", "project-a", scoped)).toBe(true);
    expect(hasReleaseGrant("user", "project-b", scoped)).toBe(false);
  });
});
