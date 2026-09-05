import {authorizeAdmin, requireAdminRole, type AdminAuthorizationDependencies, type AdminFailure} from "./admin-auth.ts";
import {isRecord, type AdminPayment, type AdminPaymentPayload, type PaymentCommand} from "../src/adminPayment.ts";

export type AdminPaymentDependencies = AdminAuthorizationDependencies & {
  readonly transitionsEnabled: boolean;
  readonly readPayment: (actorAdminUserId: string, appointmentRequestId: string) => Promise<AdminPayment>;
  readonly transitionPayment: (
    actorAdminUserId: string, appointmentRequestId: string, command: PaymentCommand,
  ) => Promise<AdminPayment>;
};
type Result = {readonly status: number; readonly body: AdminPaymentPayload} | AdminFailure;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function paymentWritesEnabled(env: {
  readonly enabled?: string; readonly vercelEnv?: string; readonly nodeEnv?: string;
}): boolean {
  // 운영 전환 전에는 production에서 플래그만 바꾸어 결제 처리를 열 수 없다.
  return env.enabled === "true" && (env.vercelEnv === "preview"
    || (!env.vercelEnv && env.nodeEnv === "development"));
}

export async function handleAdminPayment(
  method: "GET" | "PATCH", authorizationHeader: string | null, appCheckHeader: string | null,
  appointmentRequestId: string, body: unknown, dependencies: AdminPaymentDependencies,
): Promise<Result> {
  const authorization = await authorizeAdmin(authorizationHeader, appCheckHeader, dependencies);
  if (!authorization.ok) return authorization.failure;
  const roleFailure = requireAdminRole(authorization.actor, ["SUPER_ADMIN", "OPERATIONS"]);
  if (roleFailure) return roleFailure;
  if (!UUID.test(appointmentRequestId)) return failure(400, "invalid_payment_request", "예약 ID를 확인해 주세요.");
  if (method === "PATCH" && !dependencies.transitionsEnabled) {
    return failure(423, "payment_writes_disabled", "이 환경에서는 결제 상태 변경이 잠겨 있습니다.");
  }
  try {
    let payment: AdminPayment;
    if (method === "PATCH") {
      const command = parseCommand(body);
      if (!command) return failure(400, "invalid_payment_request", "작업 ID, 버전, 상태, 금액과 10~500자 사유를 확인해 주세요.");
      payment = await dependencies.transitionPayment(authorization.actor.id, appointmentRequestId, command);
    } else {
      payment = await dependencies.readPayment(authorization.actor.id, appointmentRequestId);
    }
    return {status: 200, body: {payment, transitionsEnabled: dependencies.transitionsEnabled}};
  } catch (error) {
    const code = isRecord(error) ? error.code : null;
    switch (code) {
      case "22023": case "23514": return failure(400, "invalid_payment_request", "입금자명, 금액과 변경 사유를 확인해 주세요.");
      case "42501": return failure(403, "admin_detail_role_forbidden", "활성 운영 관리자 권한이 필요합니다.");
      case "P0002": return failure(404, "payment_not_found", "무통장입금 정보를 찾지 못했습니다.");
      case "40001": return failure(409, "payment_version_conflict", "결제 정보가 변경되었습니다. 다시 조회해 주세요.");
      case "P0003": return failure(409, "payment_operation_conflict", "같은 작업 ID를 다른 내용으로 재사용할 수 없습니다.");
      case "P0001": return failure(409, "payment_state_conflict", "현재 상태에서는 해당 처리를 기록할 수 없습니다. 다시 조회해 주세요.");
      default: return failure(503, "payment_service_unavailable", "결제 처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.");
    }
  }
}

function parseCommand(body: unknown): PaymentCommand | null {
  if (!isRecord(body) || typeof body.operationId !== "string" || !UUID.test(body.operationId)
      || typeof body.paymentVersion !== "number" || !Number.isSafeInteger(body.paymentVersion) || body.paymentVersion < 0
      || typeof body.targetStatus !== "string"
      || !["DEPOSIT_CONFIRMED", "REVIEW_REQUIRED", "REFUND_REQUESTED", "REFUNDED"].includes(body.targetStatus)
      || typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.trim().length > 500) return null;
  if (body.targetStatus === "DEPOSIT_CONFIRMED" || body.targetStatus === "REVIEW_REQUIRED") {
    if (typeof body.receivedAmount !== "number" || !Number.isSafeInteger(body.receivedAmount)
        || body.receivedAmount < 0 || body.receivedAmount > 2147483647) return null;
  } else if (body.receivedAmount !== null) return null;
  return {
    operationId: body.operationId, paymentVersion: body.paymentVersion,
    targetStatus: body.targetStatus as PaymentCommand["targetStatus"],
    receivedAmount: body.receivedAmount as number | null, reason: body.reason.trim(),
  };
}

function failure(status: number, error: string, message: string): AdminFailure {
  return {status, body: {error, message}};
}
