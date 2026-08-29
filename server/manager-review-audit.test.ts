import assert from "node:assert/strict";
import test from "node:test";

import {createManagerReviewAuditCommand} from "./manager-review-audit.ts";
import {managerReviewOperationHash} from "./manager-review-outbox.ts";

const HMAC_KEY = "test-manager-review-outbox-key-0001";

test("심사 감사 재처리는 최초 기록과 같은 operation ID와 내용을 사용한다", () => {
  const input = {
    actorAdminUserId: "5f0dcf7a-a842-4b79-985d-f94cf880db4a",
    managerUserId: "manager-user",
    status: "APPROVED" as const,
    reviewNote: "",
    actorAdminRole: "OPERATIONS" as const,
    operationId: "8d8fbac5-8eb1-5bb0-b584-b17919cacb7d",
    documentEvidenceDigest: "a".repeat(64),
    submissionRevision: "ts:1787961600:000000000",
  };
  assert.deepEqual(createManagerReviewAuditCommand(input, HMAC_KEY), {
    actorAdminUserId: input.actorAdminUserId,
    action: "UPDATE",
    resourceType: "MANAGER_REVIEW",
    resourceId: input.managerUserId,
    reason: "",
    outcome: "ALLOWED",
    metadata: {
      status: "APPROVED",
      operationId: input.operationId,
      actorAdminRole: "OPERATIONS",
      documentEvidenceDigest: input.documentEvidenceDigest,
      submissionRevision: input.submissionRevision,
      payloadHash: managerReviewOperationHash(input, HMAC_KEY),
    },
    operationId: input.operationId,
  });
});
