import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  erpDocumentRevisions,
  erpDocuments,
  erpStateTransitions,
} from "@paperclipai/db";
import {
  evaluateTransition,
  type ErpActorKind,
  type TransitionDecision,
} from "../domain/lifecycle.js";
import type { ErpReviewState } from "../domain/constants.js";

/**
 * Document register and revision control.
 *
 * Every query filters on `company_id`, **including single-row reads**. Core has
 * no row-level security, and the fetch-then-check pattern used elsewhere in the
 * codebase leaves the query itself untenanted. Here the predicate is the
 * boundary.
 */

export interface ErpActor {
  kind: ErpActorKind;
  id: string;
  agentId?: string | null;
  runId?: string | null;
}

export interface RegisterDocumentInput {
  docNumber: string;
  title: string;
  docType: string;
  discipline?: string | null;
  projectId?: string | null;
  partyRef?: string | null;
  revisionCode?: string;
  asset: {
    assetId: string;
    sha256: string;
    byteSize: number;
    contentType: string;
    filename?: string | null;
  };
}

export interface AddRevisionInput {
  documentId: string;
  revisionCode: string;
  changeNote?: string | null;
  asset: RegisterDocumentInput["asset"];
}

export class ErpConflictError extends Error {
  constructor(
    message: string,
    readonly currentState?: string,
  ) {
    super(message);
    this.name = "ErpConflictError";
  }
}

export class ErpNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErpNotFoundError";
  }
}

export function erpDocumentService(db: Db) {
  const service = {
    list(
      companyId: string,
      filters: {
        projectId?: string | null;
        docType?: string | null;
        limit?: number;
        offset?: number;
      } = {},
    ) {
      const predicates = [eq(erpDocuments.companyId, companyId)];
      if (filters.projectId) predicates.push(eq(erpDocuments.projectId, filters.projectId));
      if (filters.docType) predicates.push(eq(erpDocuments.docType, filters.docType));

      return db
        .select()
        .from(erpDocuments)
        .where(and(...predicates))
        .orderBy(desc(erpDocuments.updatedAt))
        .limit(Math.min(filters.limit ?? 50, 200))
        .offset(filters.offset ?? 0);
    },

    /** Company-scoped by design - never look a document up by id alone. */
    getById(companyId: string, documentId: string) {
      return db
        .select()
        .from(erpDocuments)
        .where(and(eq(erpDocuments.companyId, companyId), eq(erpDocuments.id, documentId)))
        .then((rows) => rows[0] ?? null);
    },

    listRevisions(companyId: string, documentId: string) {
      return db
        .select()
        .from(erpDocumentRevisions)
        .where(
          and(
            eq(erpDocumentRevisions.companyId, companyId),
            eq(erpDocumentRevisions.documentId, documentId),
          ),
        )
        .orderBy(desc(erpDocumentRevisions.revisionOrdinal));
    },

    getRevision(companyId: string, revisionId: string) {
      return db
        .select()
        .from(erpDocumentRevisions)
        .where(
          and(
            eq(erpDocumentRevisions.companyId, companyId),
            eq(erpDocumentRevisions.id, revisionId),
          ),
        )
        .then((rows) => rows[0] ?? null);
    },

    /**
     * Register a document together with its first revision.
     *
     * One transaction: a document whose `current_revision_id` points at nothing
     * is a broken register entry, so the two writes must land together.
     */
    async register(companyId: string, actor: ErpActor, input: RegisterDocumentInput) {
      return db.transaction(async (tx) => {
        const [document] = await tx
          .insert(erpDocuments)
          .values({
            companyId,
            docNumber: input.docNumber,
            title: input.title,
            docType: input.docType,
            discipline: input.discipline ?? null,
            projectId: input.projectId ?? null,
            partyRef: input.partyRef ?? null,
            createdByKind: actor.kind,
            createdById: actor.id,
          })
          .returning();
        if (!document) throw new Error("Failed to insert ERP document");

        const [revision] = await tx
          .insert(erpDocumentRevisions)
          .values({
            companyId,
            documentId: document.id,
            revisionCode: input.revisionCode ?? "A",
            revisionOrdinal: 1,
            reviewState: "DRAFT",
            assetId: input.asset.assetId,
            assetSha256: input.asset.sha256,
            assetByteSize: input.asset.byteSize,
            assetContentType: input.asset.contentType,
            assetFilename: input.asset.filename ?? null,
            createdByKind: actor.kind,
            createdById: actor.id,
          })
          .returning();
        if (!revision) throw new Error("Failed to insert ERP document revision");

        await tx
          .update(erpDocuments)
          .set({ currentRevisionId: revision.id, updatedAt: new Date() })
          .where(and(eq(erpDocuments.companyId, companyId), eq(erpDocuments.id, document.id)));

        return { document: { ...document, currentRevisionId: revision.id }, revision };
      });
    },

    /**
     * Append a revision. The ordinal is derived inside the transaction from the
     * current maximum, so two concurrent adds cannot both claim the same slot -
     * the unique index on (company_id, document_id, revision_ordinal) is the
     * backstop.
     */
    async addRevision(companyId: string, actor: ErpActor, input: AddRevisionInput) {
      return db.transaction(async (tx) => {
        const document = await tx
          .select()
          .from(erpDocuments)
          .where(and(eq(erpDocuments.companyId, companyId), eq(erpDocuments.id, input.documentId)))
          .then((rows) => rows[0] ?? null);
        if (!document) throw new ErpNotFoundError("Document not found");

        const [{ maxOrdinal }] = await tx
          .select({
            maxOrdinal: sql<number>`coalesce(max(${erpDocumentRevisions.revisionOrdinal}), 0)`,
          })
          .from(erpDocumentRevisions)
          .where(
            and(
              eq(erpDocumentRevisions.companyId, companyId),
              eq(erpDocumentRevisions.documentId, input.documentId),
            ),
          );

        const previous = document.currentRevisionId ?? null;
        const [revision] = await tx
          .insert(erpDocumentRevisions)
          .values({
            companyId,
            documentId: input.documentId,
            revisionCode: input.revisionCode,
            revisionOrdinal: Number(maxOrdinal) + 1,
            reviewState: "DRAFT",
            supersedesRevisionId: previous,
            assetId: input.asset.assetId,
            assetSha256: input.asset.sha256,
            assetByteSize: input.asset.byteSize,
            assetContentType: input.asset.contentType,
            assetFilename: input.asset.filename ?? null,
            changeNote: input.changeNote ?? null,
            createdByKind: actor.kind,
            createdById: actor.id,
          })
          .returning();
        if (!revision) throw new Error("Failed to insert ERP document revision");

        await tx
          .update(erpDocuments)
          .set({ currentRevisionId: revision.id, updatedAt: new Date() })
          .where(and(eq(erpDocuments.companyId, companyId), eq(erpDocuments.id, input.documentId)));

        return revision;
      });
    },

    /**
     * Record that someone fetched the bytes and checked them.
     *
     * The plugin/worker cannot read blobs, so the agent verifies and reports.
     * A mismatch is recorded rather than silently ignored: the caller decides
     * what to do, but the register keeps the evidence either way.
     */
    async recordAssetVerification(
      companyId: string,
      revisionId: string,
      observedSha256: string,
    ): Promise<{ verified: boolean; expectedSha256: string }> {
      const revision = await service.getRevision(companyId, revisionId);
      if (!revision) throw new ErpNotFoundError("Revision not found");

      const verified = revision.assetSha256 === observedSha256;
      await db
        .update(erpDocumentRevisions)
        .set({
          assetVerifiedSha256: observedSha256,
          assetVerifiedAt: verified ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(erpDocumentRevisions.companyId, companyId),
            eq(erpDocumentRevisions.id, revisionId),
          ),
        );

      return { verified, expectedSha256: revision.assetSha256 };
    },

    /**
     * Move a revision through the review lifecycle.
     *
     * The state machine decides permission; the UPDATE's WHERE clause is a
     * compare-and-swap on the expected state, so a concurrent transition loses
     * rather than silently overwriting. Zero rows updated means someone else got
     * there first - the caller is told the real current state instead of
     * retrying blindly. Same discipline core uses for issue checkout.
     */
    async transition(
      companyId: string,
      actor: ErpActor,
      input: {
        revisionId: string;
        fromState: ErpReviewState;
        toState: ErpReviewState;
        note?: string | null;
        operationId: string;
        hasReleaseGrant: boolean;
        releaseGateApproved: boolean;
      },
    ): Promise<{ decision: TransitionDecision; revision?: typeof erpDocumentRevisions.$inferSelect }> {
      const decision = evaluateTransition(input.fromState, input.toState, actor.kind, {
        hasReleaseGrant: input.hasReleaseGrant,
        releaseGateApproved: input.releaseGateApproved,
      });
      if (!decision.allowed) return { decision };

      return db.transaction(async (tx) => {
        const updated = await tx
          .update(erpDocumentRevisions)
          .set({ reviewState: input.toState, updatedAt: new Date() })
          .where(
            and(
              eq(erpDocumentRevisions.companyId, companyId),
              eq(erpDocumentRevisions.id, input.revisionId),
              eq(erpDocumentRevisions.reviewState, input.fromState),
            ),
          )
          .returning();

        const revision = updated[0];
        if (!revision) {
          const current = await tx
            .select({ reviewState: erpDocumentRevisions.reviewState })
            .from(erpDocumentRevisions)
            .where(
              and(
                eq(erpDocumentRevisions.companyId, companyId),
                eq(erpDocumentRevisions.id, input.revisionId),
              ),
            )
            .then((rows) => rows[0] ?? null);
          if (!current) throw new ErpNotFoundError("Revision not found");
          throw new ErpConflictError(
            `Revision is in state ${current.reviewState}, not ${input.fromState}`,
            current.reviewState,
          );
        }

        // No state change without an audit row - both land or neither does.
        await tx.insert(erpStateTransitions).values({
          companyId,
          documentId: revision.documentId,
          revisionId: revision.id,
          fromState: input.fromState,
          toState: input.toState,
          actorKind: actor.kind,
          actorId: actor.id,
          agentId: actor.agentId ?? null,
          runId: actor.runId ?? null,
          note: input.note ?? null,
          operationId: input.operationId,
        });

        if (input.toState === "RELEASED") {
          await tx
            .update(erpDocuments)
            .set({
              releasedRevisionId: revision.id,
              currentRevisionId: revision.id,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(erpDocuments.companyId, companyId),
                eq(erpDocuments.id, revision.documentId),
              ),
            );
        }

        return { decision, revision };
      });
    },

    listTransitions(companyId: string, revisionId: string) {
      return db
        .select()
        .from(erpStateTransitions)
        .where(
          and(
            eq(erpStateTransitions.companyId, companyId),
            eq(erpStateTransitions.revisionId, revisionId),
          ),
        )
        .orderBy(desc(erpStateTransitions.occurredAt));
    },
  };

  return service;
}

export type ErpDocumentService = ReturnType<typeof erpDocumentService>;
