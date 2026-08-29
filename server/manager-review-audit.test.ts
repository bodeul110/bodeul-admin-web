import assert from "node:assert/strict";
import test from "node:test";

import {createManagerReviewAuditCommand} from "./manager-review-audit.ts";
import {managerReviewOperationHash} from "./manager-review-outbox.ts";

test("심사 감사 재처리는 최초 기록과 같은 operation ID와 내용을 사용한다", () => {
  const input = {
    actorAdminUserId: "5f0dcf7a-a842-4b79-985d-f94cf880db4a",
    managerUserId: "manager-user",
    status: "APPROVED" as const,
    reviewNote: "",
    actorAdminRole: "OPERATIONS" as const,
    operationId: "8d8fbac5-8eb1-5bb0-b584-b17919cacb7d",
  };
  assert.deepEqual(createManagerReviewAuditCommand(input), {
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
      payloadHash: managerReviewOperationHash(input),
    },
    operationId: input.operationId,
  });
});
