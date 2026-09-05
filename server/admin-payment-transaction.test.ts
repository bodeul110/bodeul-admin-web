import assert from "node:assert/strict";
import test from "node:test";
import {runAdminPaymentTransition, type PaymentQuery} from "./admin-payment-transaction.ts";

const payment = {appointmentRequestId: "test-appointment", publicCode: "BD-ABC123", appointmentStatus: "REQUESTED",
  paymentStatusCode: "DEPOSIT_CONFIRMED", expectedAmount: 69000, depositorName: "검증 입금자", paymentDueAt: null,
  receivedAmount: 69000, confirmedByAdminUserId: "test-admin", confirmedAt: "2026-09-05T08:00:00Z",
  refundRequestedAt: null, refundedAt: null, paymentVersion: 3, events: [], hasMoreEvents: false};
const command = {operationId: "test-operation", paymentVersion: 2, targetStatus: "DEPOSIT_CONFIRMED" as const,
  receivedAmount: 69000, reason: "합성 자료의 입금 내역 대조 완료"};

test("변경과 감사 포함 재조회를 같은 연결에서 commit한다", async () => {
  const calls: {sql: string; values?: unknown[]}[] = [];
  const query: PaymentQuery = async (sql, values) => {
    calls.push({sql, values});
    return {rows: sql.includes("get_admin_bank_transfer_payment") ? [{payment}] : []};
  };
  assert.deepEqual(await runAdminPaymentTransition(query, "test-admin", "test-appointment", command), payment);
  assert.equal(calls[0].sql, "begin");
  assert.deepEqual(calls[1].values, ["test-appointment", "test-admin", command.operationId, 2, "DEPOSIT_CONFIRMED", 69000, command.reason]);
  assert.deepEqual(calls[2].values, ["test-admin", "test-appointment"]);
  assert.equal(calls[3].sql, "commit");
});

for (const stage of ["transition", "read", "parse", "commit"] as const) {
  test(`${stage} 실패 시 rollback하고 성공 응답을 만들지 않는다`, async () => {
    const calls: string[] = [];
    const query: PaymentQuery = async sql => {
      calls.push(sql);
      if ((stage === "transition" && sql.includes("transition_appointment"))
          || (stage === "read" && sql.includes("get_admin_bank_transfer"))
          || (stage === "commit" && sql === "commit")) throw new Error("검증 실패");
      return {rows: [{payment: stage === "parse" ? null : payment}]};
    };
    await assert.rejects(runAdminPaymentTransition(query, "test-admin", "test-appointment", command));
    assert.equal(calls.at(-1), "rollback");
    if (stage !== "commit") assert.ok(!calls.includes("commit"));
  });
}
