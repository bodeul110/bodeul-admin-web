import assert from "node:assert/strict";
import test from "node:test";

import {
  managerReviewAuditTombstoneExpiresAt,
  managerReviewOperationHash,
  matchesManagerReviewOperation,
  processPendingAuditOutbox,
} from "./manager-review-outbox.ts";

test("같은 작업 UUID는 1년 tombstone 동안 동일한 심사 내용에만 재사용한다", () => {
  const expected = {
    managerUserId: "manager-user",
    status: "APPROVED" as const,
    reviewNote: "서류 확인 완료",
    actorAdminUserId: "5f0dcf7a-a842-4b79-985d-f94cf880db4a",
    actorAdminRole: "OPERATIONS" as const,
  };

  const payloadHash = managerReviewOperationHash(expected);
  assert.match(payloadHash, /^[0-9a-f]{64}$/u);
  assert.equal(matchesManagerReviewOperation({payloadHash}, expected), true);
  assert.equal(matchesManagerReviewOperation({payloadHash}, {...expected, status: "REJECTED"}), false);
  assert.equal(matchesManagerReviewOperation({payloadHash}, {...expected, reviewNote: "다른 심사 내용"}), false);
  assert.equal(matchesManagerReviewOperation({payloadHash}, {...expected, actorAdminRole: "SUPER_ADMIN"}), false);
  assert.equal(matchesManagerReviewOperation(null, expected), false);
});

test("감사 tombstone 만료는 윤년을 포함해 전달 시각의 1년 뒤로 계산한다", () => {
  const deliveredAt = Date.parse("2028-02-29T12:34:56.000Z");
  assert.equal(
    new Date(managerReviewAuditTombstoneExpiresAt(deliveredAt)).toISOString(),
    "2029-02-28T12:34:56.000Z",
  );
  assert.throws(() => managerReviewAuditTombstoneExpiresAt(Number.NaN));
});

test("깨진 감사 outbox 항목은 격리하고 나머지 항목을 계속 전달한다", async () => {
  const recorded: string[] = [];
  const delivered: string[] = [];
  const failed: string[] = [];

  const count = await processPendingAuditOutbox(
    [
      {id: "invalid", data: {valid: false}},
      {id: "8d8fbac5-8eb1-5bb0-b584-b17919cacb7d", data: {valid: true}},
    ],
    (item) => {
      if (!(item.data as {valid?: boolean}).valid) throw new Error("invalid outbox");
      return item.id;
    },
    async (operationId) => {
      recorded.push(operationId);
      return "audit-id";
    },
    async (operationId) => {
      delivered.push(operationId);
    },
    (operationId) => failed.push(operationId),
  );

  assert.equal(count, 1);
  assert.deepEqual(recorded, ["8d8fbac5-8eb1-5bb0-b584-b17919cacb7d"]);
  assert.deepEqual(delivered, ["8d8fbac5-8eb1-5bb0-b584-b17919cacb7d"]);
  assert.deepEqual(failed, ["invalid"]);
});

test("감사 기록이나 전달 표시 실패도 다음 항목 처리를 막지 않는다", async () => {
  const failed: string[] = [];
  const count = await processPendingAuditOutbox(
    [
      {id: "record-failure", data: {}},
      {id: "mark-failure", data: {}},
      {id: "success", data: {}},
    ],
    (item) => item.id,
    async (operationId) => {
      if (operationId === "record-failure") throw new Error("postgres down");
      return `audit-${operationId}`;
    },
    async (operationId) => {
      if (operationId === "mark-failure") throw new Error("firestore down");
    },
    (operationId) => failed.push(operationId),
  );

  assert.equal(count, 1);
  assert.deepEqual(failed, ["record-failure", "mark-failure"]);
});
