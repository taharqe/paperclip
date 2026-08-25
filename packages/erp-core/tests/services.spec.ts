import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  erpDocumentRevisions,
  erpExtractedValues,
  erpStateTransitions,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type Db,
} from "@paperclipai/db";
import { erpDocumentService, erpProvenanceService, type ErpActor } from "../src/services/index.js";
import { ErpConflictError } from "../src/services/documents.js";

/**
 * Integration tests for the ERP services against a real PostgreSQL.
 *
 * These exercise the things a stub cannot prove: that the transactions really
 * are atomic, that the compare-and-swap really does reject a concurrent
 * transition, and that the schema constraints really do fire.
 *
 * Set `PAPERCLIP_TEST_DATABASE_URL` to use an already-running database;
 * otherwise the shared helper spawns embedded Postgres.
 */

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;
if (!support.supported) {
  console.warn(`Skipping ERP service tests: ${support.reason}`);
}

const HUMAN: ErpActor = { kind: "user", id: "user-1" };
const AGENT: ErpActor = { kind: "agent", id: "agent-1", agentId: null, runId: null };

describeDb("ERP services", () => {
  let db: Db;
  let cleanup: () => Promise<void>;
  let companyId: string;

  const asset = {
    assetId: randomUUID(),
    sha256: "a".repeat(64),
    byteSize: 1024,
    contentType: "application/pdf",
    filename: "P-101.pdf",
  };

  beforeAll(async () => {
    const database = await startEmbeddedPostgresTestDatabase("paperclip-erp-services-");
    cleanup = database.cleanup;
    db = createDb(database.connectionString);

    companyId = (await createCompany("ERP Test")).id;
  }, 120_000);

  afterAll(async () => {
    await cleanup?.();
  });

  /**
   * `companies.issue_prefix` is uniquely indexed and defaults to "PAP", so each
   * test company needs a distinct one or the second insert collides.
   */
  async function createCompany(label: string) {
    const suffix = randomUUID().replace(/[^a-z]/gi, "").slice(0, 6).toUpperCase();
    const [company] = await db
      .insert(companies)
      .values({ name: `${label} ${suffix}`, issuePrefix: `E${suffix}` })
      .returning();
    return company!;
  }

  function docs() {
    return erpDocumentService(db);
  }
  function provenance() {
    return erpProvenanceService(db);
  }

  async function registerDocument(docNumber: string) {
    return docs().register(companyId, HUMAN, {
      docNumber,
      title: "Piping and Instrumentation Diagram",
      docType: "P&ID",
      asset: { ...asset, assetId: randomUUID() },
    });
  }

  it("registers a document and its first revision atomically", async () => {
    const { document, revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);

    expect(document.currentRevisionId).toBe(revision.id);
    expect(revision.revisionCode).toBe("A");
    expect(revision.revisionOrdinal).toBe(1);
    expect(revision.reviewState).toBe("DRAFT");

    // The document row must actually point at the revision in the database,
    // not just in the returned object.
    const stored = await docs().getById(companyId, document.id);
    expect(stored?.currentRevisionId).toBe(revision.id);
  });

  it("refuses to leak a document across companies", async () => {
    const { document } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);
    const otherCompany = randomUUID();
    // Every read is company-scoped, including single-row lookups by id.
    expect(await docs().getById(otherCompany, document.id)).toBeNull();
  });

  it("enforces a unique document number per company", async () => {
    const docNumber = `DOC-${randomUUID().slice(0, 8)}`;
    await registerDocument(docNumber);
    await expect(registerDocument(docNumber)).rejects.toThrow();
  });

  it("appends revisions in order and links each to its predecessor", async () => {
    const { document, revision: revA } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);

    const revB = await docs().addRevision(companyId, HUMAN, {
      documentId: document.id,
      revisionCode: "B",
      asset: { ...asset, assetId: randomUUID(), sha256: "b".repeat(64) },
    });

    expect(revB.revisionOrdinal).toBe(2);
    expect(revB.supersedesRevisionId).toBe(revA.id);
    expect((await docs().getById(companyId, document.id))?.currentRevisionId).toBe(revB.id);
  });

  it("records an asset verification, including a mismatch", async () => {
    const { revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);

    const bad = await docs().recordAssetVerification(companyId, revision.id, "c".repeat(64));
    expect(bad.verified).toBe(false);
    let stored = await docs().getRevision(companyId, revision.id);
    // A failed check must be recorded, not silently dropped - and must not
    // leave the revision looking verified.
    expect(stored?.assetVerifiedSha256).toBe("c".repeat(64));
    expect(stored?.assetVerifiedAt).toBeNull();

    const good = await docs().recordAssetVerification(companyId, revision.id, revision.assetSha256);
    expect(good.verified).toBe(true);
    stored = await docs().getRevision(companyId, revision.id);
    expect(stored?.assetVerifiedAt).not.toBeNull();
  });

  it("writes extraction values and their run in one transaction", async () => {
    const { document, revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);

    const { extractionRun, values } = await provenance().submitExtraction(companyId, AGENT, {
      revisionId: revision.id,
      idempotencyKey: randomUUID(),
      extractionMethod: "llm_vision",
      modelId: "test-model",
      sourceSha256: revision.assetSha256,
      values: [
        {
          tag: "FV-1042",
          attribute: "design_pressure",
          valueText: "42",
          valueNumeric: 42,
          unit: "bar",
          pageNo: 7,
          locator: { page: 7, bbox: [10, 20, 30, 40] },
          confidence: 0.91,
        },
        { tag: "FV-1042", attribute: "body_material", valueText: "CS", confidence: 0.8 },
      ],
    });

    expect(values).toHaveLength(2);
    expect(extractionRun.valueCount).toBe(2);
    // Agent output is always provisional, whatever the caller asked for.
    expect(values.every((value) => value.origin === "ai")).toBe(true);
    expect(values.every((value) => value.reviewState === "unreviewed")).toBe(true);

    const stored = await docs().getRevision(companyId, revision.id);
    expect(stored?.reviewState).toBe("AI_GENERATED");

    const trace = await provenance().trace(companyId, {
      tag: "FV-1042",
      attribute: "design_pressure",
    });
    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({
      valueText: "42",
      unit: "bar",
      pageNo: 7,
      origin: "ai",
      reviewState: "unreviewed",
      docNumber: (await docs().getById(companyId, document.id))!.docNumber,
      revisionCode: "A",
      assetSha256: revision.assetSha256,
      extractionMethod: "llm_vision",
      modelId: "test-model",
    });
  });

  it("marks a human submission as human-origin", async () => {
    const { revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);
    const { values } = await provenance().submitExtraction(companyId, HUMAN, {
      revisionId: revision.id,
      idempotencyKey: randomUUID(),
      extractionMethod: "manual",
      sourceSha256: revision.assetSha256,
      values: [{ tag: "PT-1", attribute: "range_max", valueText: "100" }],
    });
    expect(values[0]!.origin).toBe("human");
  });

  it("rejects a submission containing the same tag and attribute twice", async () => {
    const { revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);
    await expect(
      provenance().submitExtraction(companyId, AGENT, {
        revisionId: revision.id,
        idempotencyKey: randomUUID(),
        extractionMethod: "parser",
        sourceSha256: revision.assetSha256,
        values: [
          { tag: "FV-1", attribute: "p", valueText: "1" },
          { tag: "fv-1", attribute: "P", valueText: "2" },
        ],
      }),
    ).rejects.toThrow(/Duplicate/i);
  });

  it("rolls the whole extraction back when any value is invalid", async () => {
    const { revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);

    await expect(
      provenance().submitExtraction(companyId, AGENT, {
        revisionId: revision.id,
        idempotencyKey: randomUUID(),
        extractionMethod: "llm_text",
        sourceSha256: revision.assetSha256,
        values: [
          { tag: "OK-1", attribute: "a", valueText: "1" },
          // Violates the 0..1 CHECK constraint on confidence.
          { tag: "BAD-1", attribute: "b", valueText: "2", confidence: 5 },
        ],
      }),
    ).rejects.toThrow();

    // Neither the run header nor the good value may survive a failed batch.
    const values = await db
      .select()
      .from(erpExtractedValues)
      .where(eq(erpExtractedValues.revisionId, revision.id));
    expect(values).toHaveLength(0);

    const stored = await docs().getRevision(companyId, revision.id);
    expect(stored?.reviewState).toBe("DRAFT");
  });

  it("moves a revision through review and records every transition", async () => {
    const { revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);

    const toReview = await docs().transition(companyId, AGENT, {
      revisionId: revision.id,
      fromState: "DRAFT",
      toState: "REQUIRES_REVIEW",
      operationId: randomUUID(),
      hasReleaseGrant: false,
      releaseGateApproved: false,
    });
    expect(toReview.decision.allowed).toBe(true);

    const approved = await docs().transition(companyId, HUMAN, {
      revisionId: revision.id,
      fromState: "REQUIRES_REVIEW",
      toState: "APPROVED",
      operationId: randomUUID(),
      hasReleaseGrant: true,
      releaseGateApproved: true,
    });
    expect(approved.decision.allowed).toBe(true);

    const transitions = await docs().listTransitions(companyId, revision.id);
    expect(transitions).toHaveLength(2);
    expect(transitions.map((entry) => entry.toState).sort()).toEqual([
      "APPROVED",
      "REQUIRES_REVIEW",
    ]);
  });

  it("never lets an agent approve or release, even holding every grant", async () => {
    const { revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);
    await docs().transition(companyId, AGENT, {
      revisionId: revision.id,
      fromState: "DRAFT",
      toState: "REQUIRES_REVIEW",
      operationId: randomUUID(),
      hasReleaseGrant: false,
      releaseGateApproved: false,
    });

    const denied = await docs().transition(companyId, AGENT, {
      revisionId: revision.id,
      fromState: "REQUIRES_REVIEW",
      toState: "APPROVED",
      operationId: randomUUID(),
      hasReleaseGrant: true,
      releaseGateApproved: true,
    });

    expect(denied.decision.allowed).toBe(false);
    if (!denied.decision.allowed) {
      expect(denied.decision.reason).toBe("agent_cannot_approve_or_release");
    }
    // And nothing was written.
    const stored = await docs().getRevision(companyId, revision.id);
    expect(stored?.reviewState).toBe("REQUIRES_REVIEW");
    expect(await docs().listTransitions(companyId, revision.id)).toHaveLength(1);
  });

  it("rejects a stale transition instead of overwriting a concurrent one", async () => {
    const { revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);

    await docs().transition(companyId, AGENT, {
      revisionId: revision.id,
      fromState: "DRAFT",
      toState: "REQUIRES_REVIEW",
      operationId: randomUUID(),
      hasReleaseGrant: false,
      releaseGateApproved: false,
    });

    // Someone else already moved it; this caller still believes it is DRAFT.
    await expect(
      docs().transition(companyId, AGENT, {
        revisionId: revision.id,
        fromState: "DRAFT",
        toState: "REJECTED",
        operationId: randomUUID(),
        hasReleaseGrant: false,
        releaseGateApproved: false,
      }),
    ).rejects.toThrow(ErpConflictError);
  });

  it("blocks RELEASED without a human-approved gate, and points the document at it once released", async () => {
    const { document, revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);
    for (const [fromState, toState] of [
      ["DRAFT", "REQUIRES_REVIEW"],
      ["REQUIRES_REVIEW", "APPROVED"],
    ] as const) {
      await docs().transition(companyId, HUMAN, {
        revisionId: revision.id,
        fromState,
        toState,
        operationId: randomUUID(),
        hasReleaseGrant: true,
        releaseGateApproved: true,
      });
    }

    const noGate = await docs().transition(companyId, HUMAN, {
      revisionId: revision.id,
      fromState: "APPROVED",
      toState: "RELEASED",
      operationId: randomUUID(),
      hasReleaseGrant: true,
      releaseGateApproved: false,
    });
    expect(noGate.decision.allowed).toBe(false);

    const released = await docs().transition(companyId, HUMAN, {
      revisionId: revision.id,
      fromState: "APPROVED",
      toState: "RELEASED",
      operationId: randomUUID(),
      hasReleaseGrant: true,
      releaseGateApproved: true,
    });
    expect(released.decision.allowed).toBe(true);
    expect((await docs().getById(companyId, document.id))?.releasedRevisionId).toBe(revision.id);
  });

  it("lets a human review a value but refuses an agent", async () => {
    const { revision } = await registerDocument(`DOC-${randomUUID().slice(0, 8)}`);
    const { values } = await provenance().submitExtraction(companyId, AGENT, {
      revisionId: revision.id,
      idempotencyKey: randomUUID(),
      extractionMethod: "llm_text",
      sourceSha256: revision.assetSha256,
      values: [{ tag: "FV-9", attribute: "p", valueText: "10", valueNumeric: 10, unit: "bar" }],
    });
    const valueId = values[0]!.id;

    await expect(
      provenance().review(companyId, AGENT, { valueId, reviewState: "accepted" }),
    ).rejects.toThrow(/human/i);

    const reviewed = await provenance().review(companyId, HUMAN, {
      valueId,
      reviewState: "corrected",
      correctedValueText: "12",
      correctedUnit: "bar",
      note: "Transposed digits on page 7",
    });
    expect(reviewed.reviewState).toBe("corrected");
    expect(reviewed.reviewedByUserId).toBe("user-1");
    // The original extraction is preserved alongside the correction, so the
    // provenance record still shows what the document actually said.
    expect(reviewed.valueText).toBe("10");
    expect(reviewed.correctedValueText).toBe("12");
  });

  it("cascades ERP rows when the owning company is deleted", async () => {
    const scopedId = (await createCompany("ERP Cascade")).id;

    const { revision } = await erpDocumentService(db).register(scopedId, HUMAN, {
      docNumber: "CASCADE-1",
      title: "Doomed",
      docType: "P&ID",
      asset: { ...asset, assetId: randomUUID() },
    });
    await erpDocumentService(db).transition(scopedId, HUMAN, {
      revisionId: revision.id,
      fromState: "DRAFT",
      toState: "REQUIRES_REVIEW",
      operationId: randomUUID(),
      hasReleaseGrant: true,
      releaseGateApproved: false,
    });

    await db.delete(companies).where(eq(companies.id, scopedId));

    expect(
      await db
        .select()
        .from(erpDocumentRevisions)
        .where(eq(erpDocumentRevisions.companyId, scopedId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(erpStateTransitions)
        .where(eq(erpStateTransitions.companyId, scopedId)),
    ).toHaveLength(0);
  });
});
