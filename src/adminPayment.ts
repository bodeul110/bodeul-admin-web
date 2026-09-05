export const PAYMENT_STATUSES = [
  "AWAITING_DEPOSIT", "DEPOSIT_CONFIRMED", "REVIEW_REQUIRED",
  "REFUND_REQUESTED", "REFUNDED", "CANCELED",
] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];
export type PaymentTarget = "DEPOSIT_CONFIRMED" | "REVIEW_REQUIRED" | "REFUND_REQUESTED" | "REFUNDED";

export type PaymentEvent = {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorRole: string;
  readonly eventType: string;
  readonly previousStatusCode: string;
  readonly nextStatusCode: string;
  readonly receivedAmount: number | null;
  readonly reason: string;
  readonly createdAt: string;
};

export type AdminPayment = {
  readonly appointmentRequestId: string;
  readonly publicCode: string;
  readonly appointmentStatus: string;
  readonly paymentStatusCode: PaymentStatus;
  readonly expectedAmount: number;
  readonly depositorName: string;
  readonly paymentDueAt: string | null;
  readonly receivedAmount: number | null;
  readonly confirmedByAdminUserId: string | null;
  readonly confirmedAt: string | null;
  readonly refundRequestedAt: string | null;
  readonly refundedAt: string | null;
  readonly paymentVersion: number;
  readonly events: readonly PaymentEvent[];
  readonly hasMoreEvents: boolean;
};

export type PaymentCommand = {
  readonly operationId: string;
  readonly paymentVersion: number;
  readonly targetStatus: PaymentTarget;
  readonly receivedAmount: number | null;
  readonly reason: string;
};
export type AdminPaymentPayload = {readonly payment: AdminPayment; readonly transitionsEnabled: boolean};

export const PAYMENT_LABELS: Record<string, string> = {
  AWAITING_DEPOSIT: "입금 확인 대기", DEPOSIT_CONFIRMED: "입금 확인",
  REVIEW_REQUIRED: "검토 필요", REFUND_REQUESTED: "환불 요청",
  REFUNDED: "환불 완료", CANCELED: "입금 처리 취소",
  CREATED: "결제 생성", DEPOSITOR_UPDATED: "입금자명 변경",
};

export function availablePaymentTargets(payment: AdminPayment): readonly PaymentTarget[] {
  switch (payment.paymentStatusCode) {
    case "AWAITING_DEPOSIT": return ["DEPOSIT_CONFIRMED", "REVIEW_REQUIRED"];
    case "REVIEW_REQUIRED": return payment.appointmentStatus === "CANCELED"
      ? ["REFUND_REQUESTED"] : ["DEPOSIT_CONFIRMED", "REFUND_REQUESTED"];
    case "DEPOSIT_CONFIRMED": return ["REFUND_REQUESTED"];
    case "REFUND_REQUESTED": return ["REFUNDED"];
    case "CANCELED": return ["REVIEW_REQUIRED"];
    default: return [];
  }
}

export function parseAdminPayment(value: unknown): AdminPayment {
  if (!isRecord(value) || !PAYMENT_STATUSES.includes(value.paymentStatusCode as PaymentStatus)
      || !Array.isArray(value.events) || value.events.length > 20
      || typeof value.hasMoreEvents !== "boolean") {
    throw new Error("결제 응답 형식이 올바르지 않습니다.");
  }
  return {
    appointmentRequestId: text(value.appointmentRequestId), publicCode: text(value.publicCode),
    appointmentStatus: text(value.appointmentStatus), paymentStatusCode: value.paymentStatusCode as PaymentStatus,
    expectedAmount: integer(value.expectedAmount), depositorName: text(value.depositorName),
    paymentDueAt: nullableText(value.paymentDueAt), receivedAmount: nullableInteger(value.receivedAmount),
    confirmedByAdminUserId: nullableText(value.confirmedByAdminUserId), confirmedAt: nullableText(value.confirmedAt),
    refundRequestedAt: nullableText(value.refundRequestedAt), refundedAt: nullableText(value.refundedAt),
    paymentVersion: integer(value.paymentVersion), hasMoreEvents: value.hasMoreEvents,
    events: value.events.map(event => {
      if (!isRecord(event)) throw new Error("결제 이력 형식이 올바르지 않습니다.");
      return {
        id: text(event.id), actorUserId: nullableText(event.actorUserId), actorRole: text(event.actorRole),
        eventType: text(event.eventType), previousStatusCode: text(event.previousStatusCode),
        nextStatusCode: text(event.nextStatusCode), receivedAmount: nullableInteger(event.receivedAmount),
        reason: text(event.reason), createdAt: text(event.createdAt),
      };
    }),
  };
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("결제 응답의 문자열 값이 올바르지 않습니다.");
  return value;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("결제 응답의 정수 값이 올바르지 않습니다.");
  }
  return value;
}
function nullableInteger(value: unknown): number | null { return value === null ? null : integer(value); }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
