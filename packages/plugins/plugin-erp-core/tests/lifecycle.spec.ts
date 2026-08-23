import { describe, expect, it } from "vitest";
import { ERP_REVIEW_STATES, type ErpReviewState } from "../src/constants.js";
import {
  agentReachableStates,
  evaluateTransition,
  isProvisionalState,
  type ErpActorKind,
  type TransitionContext,
} from "../src/erp/lifecycle.js";

const ACTOR_KINDS: ErpActorKind[] = ["user", "agent", "plugin"];

/** The most permissive context possible - nothing here may rescue an agent. */
const FULLY_PERMITTED: TransitionContext = {
  hasReleaseGrant: true,
  releaseGateApproved: true,
};

describe("evaluateTransition", () => {
  it("walks the happy path from draft to released", () => {
    const steps: Array<[ErpReviewState, ErpReviewState, ErpActorKind]> = [
      ["DRAFT", "AI_GENERATED", "agent"],
      ["AI_GENERATED", "REQUIRES_REVIEW", "agent"],
      ["REQUIRES_REVIEW", "APPROVED", "user"],
      ["APPROVED", "RELEASED", "user"],
    ];
    for (const [from, to, actorKind] of steps) {
      expect(
        evaluateTransition(from, to, actorKind, FULLY_PERMITTED),
        `${actorKind}: ${from} -> ${to}`,
      ).toEqual({ allowed: true });
    }
  });

  it("never lets a non-human reach APPROVED or RELEASED, from any state, with every grant", () => {
    // This is the core safety property of the whole ERP. Exhaustive on purpose.
    for (const actorKind of ACTOR_KINDS.filter((kind) => kind !== "user")) {
      for (const from of ERP_REVIEW_STATES) {
        for (const to of ["APPROVED", "RELEASED"] as const) {
          if (from === to) continue;
          const decision = evaluateTransition(from, to, actorKind, FULLY_PERMITTED);
          expect(decision.allowed, `${actorKind}: ${from} -> ${to} must be denied`).toBe(false);
          if (!decision.allowed) {
            expect(decision.reason).toBe("agent_cannot_approve_or_release");
          }
        }
      }
    }
  });

  it("requires the release grant even for a human", () => {
    const decision = evaluateTransition("REQUIRES_REVIEW", "APPROVED", "user", {
      hasReleaseGrant: false,
      releaseGateApproved: true,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "missing_release_grant" });
  });

  it("requires a human-approved gate before RELEASED", () => {
    const decision = evaluateTransition("APPROVED", "RELEASED", "user", {
      hasReleaseGrant: true,
      releaseGateApproved: false,
    });
    expect(decision).toMatchObject({ allowed: false, reason: "release_gate_not_approved" });
  });

  it("treats RELEASED as terminal", () => {
    for (const to of ERP_REVIEW_STATES) {
      if (to === "RELEASED") continue;
      const decision = evaluateTransition("RELEASED", to, "user", FULLY_PERMITTED);
      expect(decision.allowed, `RELEASED -> ${to} must be denied`).toBe(false);
    }
  });

  it("rejects a no-op and an unknown state", () => {
    expect(evaluateTransition("DRAFT", "DRAFT", "user", FULLY_PERMITTED)).toMatchObject({
      allowed: false,
      reason: "not_a_transition",
    });
    expect(evaluateTransition("DRAFT", "PUBLISHED", "user", FULLY_PERMITTED)).toMatchObject({
      allowed: false,
      reason: "unknown_state",
    });
  });

  it("permits exactly the intended set across the full state x state x actor matrix", () => {
    const permitted: string[] = [];
    for (const from of ERP_REVIEW_STATES) {
      for (const to of ERP_REVIEW_STATES) {
        for (const actorKind of ACTOR_KINDS) {
          if (evaluateTransition(from, to, actorKind, FULLY_PERMITTED).allowed) {
            permitted.push(`${actorKind}:${from}->${to}`);
          }
        }
      }
    }

    // 6 states x 6 states x 3 actors = 108 combinations. Derive the expected
    // set from the intent rather than pinning a magic number: any actor may
    // drive an uncontrolled transition, only a human may reach APPROVED or
    // RELEASED, and RELEASED is terminal.
    const uncontrolled: Record<string, string[]> = {
      DRAFT: ["AI_GENERATED", "REQUIRES_REVIEW", "REJECTED"],
      AI_GENERATED: ["REQUIRES_REVIEW", "REJECTED", "DRAFT"],
      REQUIRES_REVIEW: ["REJECTED", "DRAFT"],
      APPROVED: ["REQUIRES_REVIEW", "REJECTED"],
      RELEASED: [],
      REJECTED: ["DRAFT"],
    };
    const humanOnly: Array<[string, string]> = [
      ["REQUIRES_REVIEW", "APPROVED"],
      ["APPROVED", "RELEASED"],
    ];

    const expected = [
      ...Object.entries(uncontrolled).flatMap(([from, targets]) =>
        targets.flatMap((to) => ACTOR_KINDS.map((kind) => `${kind}:${from}->${to}`)),
      ),
      ...humanOnly.map(([from, to]) => `user:${from}->${to}`),
    ];

    expect(permitted.sort()).toEqual(expected.sort());
    // 11 uncontrolled transitions x 3 actors, plus 2 human-only = 35.
    expect(permitted).toHaveLength(35);
  });

  it("marks every non-controlled state as provisional", () => {
    expect(isProvisionalState("AI_GENERATED")).toBe(true);
    expect(isProvisionalState("REQUIRES_REVIEW")).toBe(true);
    expect(isProvisionalState("APPROVED")).toBe(false);
    expect(isProvisionalState("RELEASED")).toBe(false);
  });

  it("excludes controlled states from the agent-reachable set", () => {
    expect(agentReachableStates()).not.toContain("APPROVED");
    expect(agentReachableStates()).not.toContain("RELEASED");
  });
});
