import assert from "node:assert/strict";
import test from "node:test";

import type {ManagerDocumentEvidence} from "./manager-document-evidence.ts";
import {validateManagerReviewTransition} from "./manager-review-transition.ts";

const ACTOR_ID = "5f0dcf7a-a842-4b79-985d-f94cf880db4a";
const MANAGER_ID = "manager-user";
const REVISION = "ts:1787961600:000000000";
const KEYS = ["idCard", "license", "criminalRecord"] as const;

function evidence(): readonly ManagerDocumentEvidence[] {
  return KEYS.map((documentKey, index) => ({
    version: 1,
    actorAdminUserId: ACTOR_ID,
    managerUserId: MANAGER_ID,
    documentKey,
    storagePathDigest: String(index + 1).repeat(64),
    generation: String(100 + index),
    digest: String(index + 4).repeat(64),
    contentType: "image/png",
    submissionRevision: REVISION,
    issuedAt: 1,
    expiresAt: 2,
  }));
}

function validInput() {
  const documentEvidence = evidence();
  return {
    currentStatus: "PENDING_REVIEW",
    currentSubmissionRevision: REVISION,
    expectedSubmissionRevision: REVISION,
    decision: "APPROVED" as const,
    actorAdminUserId: ACTOR_ID,
    managerUserId: MANAGER_ID,
    documentEvidence,
    currentStoragePathDigests: Object.fromEntries(
      documentEvidence.map((item) => [item.documentKey, item.storagePathDigest]),
    ),
  };
}

test("승인은 검증한 세대와 digest를 문서별 snapshot으로 고정한다", () => {
  const snapshots = validateManagerReviewTransition(validInput());
  assert.equal(snapshots.length, 3);
  assert.deepEqual(
    snapshots.map(({documentKey, generation, digest, submissionRevision}) => (
      {documentKey, generation, digest, submissionRevision}
    )),
    [
      {documentKey: "criminalRecord", generation: "102", digest: "6".repeat(64), submissionRevision: REVISION},
      {documentKey: "idCard", generation: "100", digest: "4".repeat(64), submissionRevision: REVISION},
      {documentKey: "license", generation: "101", digest: "5".repeat(64), submissionRevision: REVISION},
    ],
  );
});

test("조회 후 revision 또는 문서 포인터가 바뀐 race를 거부한다", () => {
  assert.throws(() => validateManagerReviewTransition({
    ...validInput(),
    currentSubmissionRevision: "ts:1787961601:000000000",
  }), (error: unknown) => (error as {code?: string}).code === "manager_document_revision_stale");
  assert.throws(() => validateManagerReviewTransition({
    ...validInput(),
    currentStoragePathDigests: {...validInput().currentStoragePathDigests, idCard: "9".repeat(64)},
  }), (error: unknown) => (error as {code?: string}).code === "manager_document_evidence_stale");
});

test("처리된 revision의 새 operation replay는 상태 전이에서 거부하고 반려도 revision을 소비한다", () => {
  assert.throws(() => validateManagerReviewTransition({
    ...validInput(),
    currentStatus: "APPROVED",
  }), (error: unknown) => (error as {code?: string}).code === "manager_review_not_pending");
  assert.deepEqual(validateManagerReviewTransition({
    ...validInput(),
    decision: "REJECTED",
    documentEvidence: [],
  }), []);
});
