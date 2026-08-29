import assert from "node:assert/strict";
import test from "node:test";

import {
  handleListManagerReviews,
  handleLoadManagerDocument,
  handleSaveManagerReview,
  parseManagerDocumentReasonBody,
  type AdminManagerReviewDependencies,
} from "./admin-manager-reviews.ts";

const ACTOR_ID = "5f0dcf7a-a842-4b79-985d-f94cf880db4a";
const OPERATION_ID = "8d8fbac5-8eb1-5bb0-b584-b17919cacb7d";

test("원문 조회 사유 JSON은 한글을 변형하지 않고 읽는다", () => {
  assert.equal(
    parseManagerDocumentReasonBody({reason: "  매니저 자격 심사를 위한 원본 확인  "}),
    "매니저 자격 심사를 위한 원본 확인",
  );
  assert.equal(parseManagerDocumentReasonBody(null), "");
});

const dependencies: AdminManagerReviewDependencies = {
  mode: "off",
  allowedAppIds: new Set(),
  async verifyAppCheckToken() { throw new Error("호출되지 않아야 합니다."); },
  recordVerdict() {},
  async verifyIdToken() { return {uid: "admin-uid"}; },
  async findAppUserByFirebaseUid() {
    return {id: ACTOR_ID, role: "ADMIN", adminRole: "OPERATIONS", breakGlassExpiresAt: null};
  },
  async listManagerReviews() {
    return [{
      id: "manager-user",
      name: "김*영",
      maskedEmail: "ma***@example.com",
      maskedPhone: "010-****-1234",
      createdAt: "2026-08-29T00:00:00.000Z",
      status: "PENDING_REVIEW",
      documentSummary: "서류 제출 완료",
      reviewNote: "",
      availableDocumentKeys: ["idCard"],
    }];
  },
  async saveManagerReview(managerId, status, note, actorId, actorRole, operationId) {
    assert.deepEqual(
      [managerId, status, note, actorId, actorRole, operationId],
      ["manager-user", "APPROVED", "", ACTOR_ID, "OPERATIONS", OPERATION_ID],
    );
    return {auditState: "PENDING"};
  },
  async markManagerReviewAuditDelivered(operationId, auditId) {
    assert.deepEqual([operationId, auditId], [OPERATION_ID, OPERATION_ID]);
  },
  async reconcilePendingManagerReviewAudits() { return 0; },
  async loadManagerDocument(managerId, documentKey) {
    assert.deepEqual([managerId, documentKey], ["manager-user", "idCard"]);
    return {
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "id-card.pdf",
      contentType: "application/pdf",
      updatedAt: "2026-08-29T00:00:00.000Z",
    };
  },
  async recordAdminAccessAudit(command) {
    assert.equal(command.actorAdminUserId, ACTOR_ID);
    if (command.resourceType === "MANAGER_REVIEW" && command.outcome === "ALLOWED") {
      assert.equal(command.operationId, OPERATION_ID);
      assert.equal(command.metadata?.actorAdminRole, "OPERATIONS");
    }
    return "8d8fbac5-8eb1-5bb0-b584-b17919cacb7d";
  },
};

test("OPERATIONS는 마스킹된 매니저 심사 목록을 조회한다", async () => {
  const result = await handleListManagerReviews("Bearer token", null, dependencies);
  assert.equal(result.status, 200);
  assert.equal("items" in result.body ? result.body.items[0]?.maskedPhone : "", "010-****-1234");
});

test("감사 outbox 재처리 실패는 매니저 목록 조회를 막지 않는다", async () => {
  const result = await handleListManagerReviews("Bearer token", null, {
    ...dependencies,
    async reconcilePendingManagerReviewAudits() {
      throw new Error("poisoned outbox");
    },
  });

  assert.equal(result.status, 200);
  assert.equal("items" in result.body ? result.body.items.length : 0, 1);
});

test("DEVELOPER는 목록·심사·원문 조회를 모두 거부한다", async () => {
  const deniedOutcomes: string[] = [];
  const developerDependencies = {
    ...dependencies,
    async findAppUserByFirebaseUid() {
      return {id: ACTOR_ID, role: "ADMIN" as const, adminRole: "DEVELOPER" as const, breakGlassExpiresAt: null};
    },
    async recordAdminAccessAudit(command: Parameters<AdminManagerReviewDependencies["recordAdminAccessAudit"]>[0]) {
      deniedOutcomes.push(command.outcome);
      return OPERATION_ID;
    },
  };
  const list = await handleListManagerReviews("Bearer token", null, developerDependencies);
  const review = await handleSaveManagerReview("Bearer token", null, {
    managerUserId: "manager-user", status: "APPROVED", reviewNote: "", operationId: OPERATION_ID,
  }, developerDependencies);
  const document = await handleLoadManagerDocument(
    "Bearer token", null, "manager-user", "idCard", "매니저 자격 심사를 위한 원본 확인", developerDependencies,
  );
  assert.equal(list.status, 403);
  assert.equal(review.status, 403);
  assert.equal(document.status, 403);
  assert.deepEqual(deniedOutcomes, ["DENIED", "DENIED", "DENIED"]);
});

test("비인증 원문 요청은 actor가 없으므로 감사 함수를 호출하지 않는다", async () => {
  let auditCalled = false;
  const result = await handleLoadManagerDocument(
    null, null, "manager-user", "idCard", "매니저 자격 심사를 위한 원본 확인", {
      ...dependencies,
      async recordAdminAccessAudit() { auditCalled = true; return OPERATION_ID; },
    },
  );
  assert.equal(result.status, 401);
  assert.equal(auditCalled, false);
});

test("심사 저장은 서버가 확인한 actor UUID를 사용한다", async () => {
  const result = await handleSaveManagerReview("Bearer token", null, {
    managerUserId: "manager-user",
    status: "APPROVED",
    reviewNote: "",
    operationId: OPERATION_ID,
  }, dependencies);
  assert.equal(result.status, 200);
  assert.equal("auditState" in result.body ? result.body.auditState : "", "RECORDED");
});

test("Firestore 심사 변경 뒤 PostgreSQL 감사 실패는 재처리 가능한 202로 구분한다", async () => {
  const result = await handleSaveManagerReview("Bearer token", null, {
    managerUserId: "manager-user",
    status: "APPROVED",
    reviewNote: "",
    operationId: OPERATION_ID,
  }, {
    ...dependencies,
    async recordAdminAccessAudit() { throw new Error("postgres down"); },
  });

  assert.equal(result.status, 202);
  assert.deepEqual(result.body, {
    updated: true,
    operationId: OPERATION_ID,
    auditState: "PENDING",
  });
});

test("이미 전달된 outbox 작업을 재시도하면 감사를 중복 기록하지 않는다", async () => {
  let auditCalled = false;
  const result = await handleSaveManagerReview("Bearer token", null, {
    managerUserId: "manager-user",
    status: "APPROVED",
    reviewNote: "",
    operationId: OPERATION_ID,
  }, {
    ...dependencies,
    async saveManagerReview() { return {auditState: "DELIVERED"}; },
    async recordAdminAccessAudit() { auditCalled = true; return OPERATION_ID; },
  });

  assert.equal(result.status, 200);
  assert.equal(auditCalled, false);
});

test("심사 입력 거부와 저장 실패는 각각 DENIED와 FAILED로 감사한다", async () => {
  const outcomes: string[] = [];
  const auditedDependencies = {
    ...dependencies,
    async recordAdminAccessAudit(command: Parameters<AdminManagerReviewDependencies["recordAdminAccessAudit"]>[0]) {
      outcomes.push(command.outcome);
      return OPERATION_ID;
    },
  };
  const invalid = await handleSaveManagerReview("Bearer token", null, {
    managerUserId: "manager-user", status: "REJECTED", reviewNote: "", operationId: OPERATION_ID,
  }, auditedDependencies);
  const failed = await handleSaveManagerReview("Bearer token", null, {
    managerUserId: "manager-user", status: "APPROVED", reviewNote: "", operationId: OPERATION_ID,
  }, {
    ...auditedDependencies,
    async saveManagerReview() { throw new Error("firestore down"); },
  });

  assert.equal(invalid.status, 400);
  assert.equal(failed.status, 503);
  assert.deepEqual(outcomes, ["DENIED", "FAILED"]);
});

test("심사 거부 감사가 실패하면 원래 409 대신 fail-closed 503을 반환한다", async () => {
  const result = await handleSaveManagerReview("Bearer token", null, {
    managerUserId: "manager-user", status: "APPROVED", reviewNote: "", operationId: OPERATION_ID,
  }, {
    ...dependencies,
    async saveManagerReview() { throw Object.assign(new Error("conflict"), {code: "P0003"}); },
    async recordAdminAccessAudit() { throw new Error("audit down"); },
  });

  assert.equal(result.status, 503);
  assert.equal("error" in result.body ? result.body.error : "", "admin_audit_failed");
});

test("원문 미리보기는 10자 이상 사유를 요구하고 감사한다", async () => {
  let documentCalled = false;
  const invalid = await handleLoadManagerDocument(
    "Bearer token", null, "manager-user", "idCard", "짧음", {
      ...dependencies,
      async loadManagerDocument() { documentCalled = true; return null; },
    },
  );
  const valid = await handleLoadManagerDocument(
    "Bearer token", null, "manager-user", "idCard", "매니저 자격 심사를 위한 원본 확인", dependencies,
  );
  assert.equal(invalid.status, 400);
  assert.equal(documentCalled, false);
  assert.equal(valid.status, 200);
  assert.equal("contentType" in valid.body ? valid.body.contentType : "", "application/pdf");
});

test("원문 조회 실패와 잘못된 사유는 각각 FAILED와 DENIED로 감사한다", async () => {
  const outcomes: string[] = [];
  const auditedDependencies = {
    ...dependencies,
    async loadManagerDocument() { throw new Error("storage down"); },
    async recordAdminAccessAudit(command: Parameters<AdminManagerReviewDependencies["recordAdminAccessAudit"]>[0]) {
      outcomes.push(command.outcome);
      return OPERATION_ID;
    },
  };
  const invalid = await handleLoadManagerDocument(
    "Bearer token", null, "manager-user", "idCard", "짧음", auditedDependencies,
  );
  const failed = await handleLoadManagerDocument(
    "Bearer token", null, "manager-user", "idCard", "매니저 자격 심사를 위한 원본 확인", auditedDependencies,
  );
  assert.equal(invalid.status, 400);
  assert.equal(failed.status, 503);
  assert.deepEqual(outcomes, ["DENIED", "FAILED"]);
});

test("비허용 원문 MIME은 성공 감사 전에 FAILED로 기록하고 415를 반환한다", async () => {
  const auditCommands: Parameters<AdminManagerReviewDependencies["recordAdminAccessAudit"]>[0][] = [];
  const result = await handleLoadManagerDocument(
    "Bearer token", null, "manager-user", "idCard", "매니저 자격 심사를 위한 원본 확인", {
      ...dependencies,
      async loadManagerDocument() {
        throw Object.assign(new Error("unsafe content type"), {code: "P0004"});
      },
      async recordAdminAccessAudit(command) {
        auditCommands.push(command);
        return OPERATION_ID;
      },
    },
  );

  assert.equal(result.status, 415);
  assert.equal("error" in result.body ? result.body.error : "", "unsupported_manager_document_type");
  assert.equal(auditCommands.length, 1);
  assert.equal(auditCommands[0]?.outcome, "FAILED");
  assert.equal(auditCommands[0]?.metadata?.failureCode, "P0004");
});

test("원문 ALLOWED 감사 기록이 실패하면 bytes를 반환하지 않는다", async () => {
  const result = await handleLoadManagerDocument(
    "Bearer token", null, "manager-user", "idCard", "매니저 자격 심사를 위한 원본 확인", {
      ...dependencies,
      async recordAdminAccessAudit() { throw new Error("postgres down"); },
    },
  );
  assert.equal(result.status, 503);
  assert.equal("bytes" in result.body, false);
});
