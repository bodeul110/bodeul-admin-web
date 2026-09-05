import assert from "node:assert/strict";
import test from "node:test";
import {handleAdminPayment, paymentWritesEnabled, type AdminPaymentDependencies} from "./admin-payments.ts";
import {availablePaymentTargets, parseAdminPayment, type AdminPayment, type PaymentCommand} from "../src/adminPayment.ts";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const APPOINTMENT = "20000000-0000-4000-8000-000000000001";
export const PAYMENT_FIXTURE: AdminPayment = {
  appointmentRequestId: APPOINTMENT, publicCode: "BD-ABC123", appointmentStatus: "REQUESTED",
  paymentStatusCode: "AWAITING_DEPOSIT", expectedAmount: 69000, depositorName: "검증 입금자",
  paymentDueAt: null, receivedAmount: null, confirmedByAdminUserId: null, confirmedAt: null,
  refundRequestedAt: null, refundedAt: null, paymentVersion: 2, events: [], hasMoreEvents: false,
};
const COMMAND: PaymentCommand = {operationId: "30000000-0000-4000-8000-000000000001",
  paymentVersion: 2, targetStatus: "DEPOSIT_CONFIRMED", receivedAmount: 69000, reason: "합성 자료의 금액과 입금자명 대조 완료"};

function setup(overrides: Partial<AdminPaymentDependencies> = {}) {
  const calls: unknown[][] = [];
  const dependencies: AdminPaymentDependencies = {
    mode: "off", allowedAppIds: new Set(), recordVerdict() {},
    async verifyAppCheckToken() { throw new Error("비활성 App Check가 호출됐습니다."); },
    async verifyIdToken() { return {uid: "test-admin"}; },
    async findAppUserByFirebaseUid() { return {id: ADMIN, role: "ADMIN", adminRole: "OPERATIONS", breakGlassExpiresAt: null}; },
    transitionsEnabled: true,
    async readPayment(...args) { calls.push(args); return PAYMENT_FIXTURE; },
    async transitionPayment(...args) { calls.push(args); return {...PAYMENT_FIXTURE, paymentStatusCode: "DEPOSIT_CONFIRMED", paymentVersion: 3}; },
    ...overrides,
  };
  return {calls, dependencies};
}
const invoke = (deps: AdminPaymentDependencies, method: "GET" | "PATCH" = "GET", body: unknown = COMMAND, token: string | null = "Bearer test-token", id = APPOINTMENT) =>
  handleAdminPayment(method, token, null, id, body, deps);

test("운영 관리자 조회와 쓰기 상태를 반환한다", async () => {
  const {calls, dependencies} = setup();
  assert.deepEqual(await invoke(dependencies), {status: 200, body: {payment: PAYMENT_FIXTURE, transitionsEnabled: true}});
  assert.deepEqual(calls, [[ADMIN, APPOINTMENT]]);
});

test("변경 담당자는 입력 본문이 아니라 검증된 관리자로 고정한다", async () => {
  const {calls, dependencies} = setup();
  assert.equal((await invoke(dependencies, "PATCH", {...COMMAND, actorAdminUserId: "spoof"})).status, 200);
  assert.deepEqual(calls, [[ADMIN, APPOINTMENT, COMMAND]]);
});

for (const method of ["GET", "PATCH"] as const) {
  test(`${method} 무인증 요청은 DB 호출 전에 거부한다`, async () => {
    const {calls, dependencies} = setup();
    assert.equal((await invoke(dependencies, method, COMMAND, null)).status, 401);
    assert.equal(calls.length, 0);
  });
  for (const role of ["PATIENT", "GUARDIAN", "MANAGER", "DEVELOPER", "REVOKED"] as const) {
    test(`${method} ${role}는 결제 데이터에 접근하지 않는다`, async () => {
      const {calls, dependencies} = setup({async findAppUserByFirebaseUid() {
        return {id: ADMIN, role: role === "DEVELOPER" || role === "REVOKED" ? "ADMIN" : role,
          adminRole: role === "DEVELOPER" ? "DEVELOPER" : null, breakGlassExpiresAt: null};
      }});
      assert.equal((await invoke(dependencies, method)).status, 403);
      assert.equal(calls.length, 0);
    });
  }
}

test("잘못된 token과 MFA·App Check 강제 정책을 우회하지 않는다", async () => {
  for (const overrides of [
    {async verifyIdToken() { throw new Error("검증 실패"); }},
    {mfaMode: "enforce" as const},
    {mode: "enforce" as const},
  ]) {
    const {calls, dependencies} = setup(overrides);
    assert.ok((await invoke(dependencies, "PATCH")).status >= 400);
    assert.equal(calls.length, 0);
  }
});

test("쓰기 gate가 닫혀도 조회는 가능하며 변경은 423으로 거부한다", async () => {
  const {calls, dependencies} = setup({transitionsEnabled: false});
  assert.equal((await invoke(dependencies)).status, 200);
  assert.equal((await invoke(dependencies, "PATCH")).status, 423);
  assert.equal(calls.length, 1);
});

test("플래그만으로 production 쓰기를 열 수 없다", () => {
  assert.equal(paymentWritesEnabled({}), false);
  assert.equal(paymentWritesEnabled({enabled: "true", vercelEnv: "production", nodeEnv: "production"}), false);
  assert.equal(paymentWritesEnabled({enabled: "true", nodeEnv: "production"}), false);
  assert.equal(paymentWritesEnabled({enabled: "TRUE", vercelEnv: "preview"}), false);
  assert.equal(paymentWritesEnabled({enabled: "true", vercelEnv: "preview", nodeEnv: "production"}), true);
  assert.equal(paymentWritesEnabled({enabled: "true", nodeEnv: "development"}), true);
});

const badInputs = [null, [], {}, {...COMMAND, operationId: "bad"}, {...COMMAND, paymentVersion: -1},
  {...COMMAND, paymentVersion: 1.5}, {...COMMAND, paymentVersion: Number.MAX_SAFE_INTEGER + 1},
  {...COMMAND, reason: "짧음"}, {...COMMAND, reason: "a".repeat(501)},
  {...COMMAND, targetStatus: "CANCELED"}, {...COMMAND, targetStatus: "AWAITING_DEPOSIT"},
  {...COMMAND, receivedAmount: null}, {...COMMAND, receivedAmount: "69000"},
  {...COMMAND, receivedAmount: -1}, {...COMMAND, receivedAmount: 1.5}, {...COMMAND, receivedAmount: 2147483648},
  {...COMMAND, targetStatus: "REFUNDED", receivedAmount: 69000},
];
test("잘못된 명령은 원장을 호출하지 않는다", async () => {
  for (const body of badInputs) {
    const {calls, dependencies} = setup();
    assert.equal((await invoke(dependencies, "PATCH", body)).status, 400);
    assert.equal(calls.length, 0);
  }
  const {calls, dependencies} = setup();
  assert.equal((await invoke(dependencies, "GET", null, "Bearer test-token", "invalid")).status, 400);
  assert.equal(calls.length, 0);
});

for (const targetStatus of ["REVIEW_REQUIRED", "REFUND_REQUESTED", "REFUNDED"] as const) {
  test(`${targetStatus} 명령을 정규화해 DB 계약으로 전달한다`, async () => {
    const {calls, dependencies} = setup();
    const body = {...COMMAND, targetStatus, receivedAmount: targetStatus === "REVIEW_REQUIRED" ? 30000 : null,
      reason: `  ${COMMAND.reason}  `};
    assert.equal((await invoke(dependencies, "PATCH", body)).status, 200);
    assert.deepEqual(calls[0], [ADMIN, APPOINTMENT, {...body, reason: COMMAND.reason}]);
  });
}

test("같은 요청을 재시도할 때 작업 ID나 버전을 바꾸지 않는다", async () => {
  const {calls, dependencies} = setup();
  await invoke(dependencies, "PATCH");
  await invoke(dependencies, "PATCH");
  assert.deepEqual(calls[0], calls[1]);
});

for (const [code, status] of [["22023", 400], ["23514", 400], ["42501", 403], ["P0002", 404],
  ["40001", 409], ["P0003", 409], ["P0001", 409], ["XX000", 503]] as const) {
  test(`DB 오류 ${code}를 ${status}로 변환하고 원문을 숨긴다`, async () => {
    const {dependencies} = setup({async transitionPayment() { throw {code, message: "private DB connection and depositor data"}; }});
    const result = await invoke(dependencies, "PATCH");
    assert.equal(result.status, status);
    assert.ok(!JSON.stringify(result).includes("private DB"));
  });
}

test("취소 예약의 지연 입금은 검토 뒤 환불로만 진행한다", () => {
  assert.deepEqual(availablePaymentTargets({...PAYMENT_FIXTURE, paymentStatusCode: "CANCELED", appointmentStatus: "CANCELED"}), ["REVIEW_REQUIRED"]);
  assert.deepEqual(availablePaymentTargets({...PAYMENT_FIXTURE, paymentStatusCode: "REVIEW_REQUIRED", appointmentStatus: "CANCELED"}), ["REFUND_REQUESTED"]);
  assert.deepEqual(availablePaymentTargets({...PAYMENT_FIXTURE, paymentStatusCode: "REFUNDED"}), []);
});

test("응답은 알 수 없는 상태·비정상 금액·과다 이력을 허용하지 않는다", () => {
  assert.deepEqual(parseAdminPayment(PAYMENT_FIXTURE), PAYMENT_FIXTURE);
  for (const value of [null, {...PAYMENT_FIXTURE, paymentStatusCode: "UNKNOWN"},
    {...PAYMENT_FIXTURE, receivedAmount: "69000"}, {...PAYMENT_FIXTURE, expectedAmount: -1},
    {...PAYMENT_FIXTURE, paymentVersion: Number.MAX_SAFE_INTEGER + 1}, {...PAYMENT_FIXTURE, events: Array(21).fill({})}]) {
    assert.throws(() => parseAdminPayment(value));
  }
});
