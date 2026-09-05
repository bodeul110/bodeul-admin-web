import {parseAdminPayment, type AdminPayment, type PaymentCommand} from "../src/adminPayment.ts";

export type PaymentQuery = (sql: string, values?: unknown[]) => Promise<{rows: {payment?: unknown}[]}>;

export async function runAdminPaymentTransition(
  query: PaymentQuery, actorAdminUserId: string, appointmentRequestId: string, command: PaymentCommand,
): Promise<AdminPayment> {
  await query("begin");
  try {
    await query(
      "select * from bodeul.transition_appointment_bank_transfer_payment($1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::integer, $7::text)",
      [appointmentRequestId, actorAdminUserId, command.operationId, command.paymentVersion,
        command.targetStatus, command.receivedAmount, command.reason],
    );
    // 변경과 상세 재조회·조회 감사를 한 트랜잭션으로 처리한다.
    const result = await query("select bodeul.get_admin_bank_transfer_payment($1::uuid, $2::uuid) as payment",
      [actorAdminUserId, appointmentRequestId]);
    const payment = parseAdminPayment(result.rows[0]?.payment);
    await query("commit");
    return payment;
  } catch (error) {
    await query("rollback");
    throw error;
  }
}
