import { ERP_REVIEW_STATES, type ErpReviewState } from "../constants.js";

/**
 * The document revision state machine.
 *
 * This is the human-in-the-loop guarantee, expressed as a pure function so it
 * can be exhaustively tested without a database, a worker, or an agent.
 *
 *   DRAFT ──extract──> AI_GENERATED ──submit──> REQUIRES_REVIEW
 *                                                 │        │
 *                                        approve  │        │  reject
 *                                                 v        v
 *                                            APPROVED   REJECTED
 *                                                 │
 *                                       release   │  (needs an approved gate)
 *                                                 v
 *                                             RELEASED
 *
 * Two rules sit above every grant and cannot be granted around:
 *
 *  1. An agent can never reach APPROVED or RELEASED. Not with any ERP role,
 *     not even erp_admin. AI output must never appear as approved engineering
 *     information.
 *  2. RELEASED additionally requires a release gate that a human has decided.
 */

export type ErpActorKind = "user" | "agent" | "plugin";

export type TransitionDenialReason =
  | "unknown_state"
  | "not_a_transition"
  | "illegal_transition"
  | "agent_cannot_approve_or_release"
  | "requires_human_actor"
  | "missing_release_grant"
  | "release_gate_not_approved";

export interface TransitionContext {
  /** True when the actor holds an ERP grant permitting approve/release. */
  hasReleaseGrant: boolean;
  /**
   * True only when a core approval linked to this revision has been decided
   * approved by a human. Required for RELEASED.
   */
  releaseGateApproved: boolean;
}

export type TransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: TransitionDenialReason; explanation: string };

/** States an agent may drive a revision into. Deliberately excludes APPROVED and RELEASED. */
const AGENT_REACHABLE_STATES: ReadonlySet<ErpReviewState> = new Set<ErpReviewState>([
  "DRAFT",
  "AI_GENERATED",
  "REQUIRES_REVIEW",
  "REJECTED",
]);

/** States that represent a controlled, human-authorised outcome. */
const CONTROLLED_STATES: ReadonlySet<ErpReviewState> = new Set<ErpReviewState>([
  "APPROVED",
  "RELEASED",
]);

const ALLOWED_TRANSITIONS: Readonly<Record<ErpReviewState, readonly ErpReviewState[]>> = {
  DRAFT: ["AI_GENERATED", "REQUIRES_REVIEW", "REJECTED"],
  AI_GENERATED: ["REQUIRES_REVIEW", "REJECTED", "DRAFT"],
  REQUIRES_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["RELEASED", "REQUIRES_REVIEW", "REJECTED"],
  RELEASED: [],
  REJECTED: ["DRAFT"],
};

export function isErpReviewState(value: string): value is ErpReviewState {
  return (ERP_REVIEW_STATES as readonly string[]).includes(value);
}

function deny(reason: TransitionDenialReason, explanation: string): TransitionDecision {
  return { allowed: false, reason, explanation };
}

/**
 * Decide whether `from -> to` is permitted for this actor.
 *
 * Order matters: the two hard rules are evaluated before any grant lookup, so
 * no permission configuration can route around them.
 */
export function evaluateTransition(
  from: string,
  to: string,
  actorKind: ErpActorKind,
  context: TransitionContext,
): TransitionDecision {
  if (!isErpReviewState(from) || !isErpReviewState(to)) {
    return deny("unknown_state", `Unknown review state in transition ${from} -> ${to}`);
  }
  if (from === to) {
    return deny("not_a_transition", `Revision is already in state ${from}`);
  }

  // Hard rule 1 - checked before grants, and before whether the transition is
  // even legal, so the denial reason is always the most important one.
  if (actorKind !== "user" && CONTROLLED_STATES.has(to)) {
    return deny(
      "agent_cannot_approve_or_release",
      `A ${actorKind} actor can never move a revision to ${to}. Approval and release require a human.`,
    );
  }

  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return deny("illegal_transition", `${from} -> ${to} is not a permitted transition`);
  }

  if (CONTROLLED_STATES.has(to)) {
    if (actorKind !== "user") {
      return deny("requires_human_actor", `${to} requires a human actor`);
    }
    if (!context.hasReleaseGrant) {
      return deny("missing_release_grant", `${to} requires the ERP release grant`);
    }
  }

  // Hard rule 2 - a released document must be traceable to a human decision
  // recorded in the core approvals table.
  if (to === "RELEASED" && !context.releaseGateApproved) {
    return deny(
      "release_gate_not_approved",
      "RELEASED requires a linked approval that a human has approved",
    );
  }

  return { allowed: true };
}

/** True when a revision in this state must not be presented as engineering record. */
export function isProvisionalState(state: ErpReviewState): boolean {
  return !CONTROLLED_STATES.has(state);
}

/** States an agent is permitted to write. Exported for tests and UI affordances. */
export function agentReachableStates(): ErpReviewState[] {
  return [...AGENT_REACHABLE_STATES];
}
