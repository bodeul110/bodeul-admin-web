import {
  authorizeAdmin,
  requireAdminRole,
  type AdminAuthorizationDependencies,
  type AdminDetailRole,
  type AdminErrorBody,
} from "./admin-auth.ts";
import type {AdminAuditCommand} from "./postgres.ts";
import {createManagerReviewAuditCommand} from "./manager-review-audit.ts";
import {
  managerDocumentEvidenceSetDigest,
  type ManagerDocumentEvidence,
} from "./manager-document-evidence.ts";

export type ManagerDocumentKey = "idCard" | "license" | "criminalRecord";

export type AdminManagerReviewItem = {
  readonly id: string;
  readonly name: string;
  readonly maskedEmail: string;
  readonly maskedPhone: string;
  readonly createdAt: string;
  readonly status: "PENDING" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  readonly documentSummary: string;
  readonly reviewNote: string;
  readonly availableDocumentKeys: readonly ManagerDocumentKey[];
  readonly submissionRevision: string;
};

export type AdminManagerDocument = {
  readonly bytes: Uint8Array;
  readonly contentType: "image/webp";
  readonly updatedAt: string;
  readonly evidenceToken: string;
};

export type AdminManagerReviewDependencies = AdminAuthorizationDependencies & {
  readonly listManagerReviews: () => Promise<readonly AdminManagerReviewItem[]>;
  readonly saveManagerReview: (
    managerUserId: string,
    status: "APPROVED" | "REJECTED",
    reviewNote: string,
    actorAdminUserId: string,
    actorAdminRole: AdminDetailRole,
    operationId: string,
    hmacKey: string,
    documentEvidence: readonly ManagerDocumentEvidence[],
    documentEvidenceDigest: string,
    submissionRevision: string,
  ) => Promise<{readonly auditState: "PENDING" | "DELIVERED"}>;
  readonly verifyManagerDocumentEvidenceTokens: (
    tokens: readonly string[],
    actorAdminUserId: string,
    managerUserId: string,
    hmacKey: string,
  ) => Promise<readonly ManagerDocumentEvidence[]>;
  readonly getManagerReviewOutboxHmacKey: () => string;
  readonly markManagerReviewAuditDelivered: (operationId: string, auditId: string) => Promise<void>;
  readonly reconcilePendingManagerReviewAudits: () => Promise<number>;
  readonly loadManagerDocument: (
    managerUserId: string,
    documentKey: ManagerDocumentKey,
    actorAdminUserId: string,
    hmacKey: string,
  ) => Promise<AdminManagerDocument | null>;
  readonly recordAdminAccessAudit: (command: AdminAuditCommand) => Promise<string>;
};

export type AdminManagerListResult = {
  readonly status: number;
  readonly body: {readonly items: readonly AdminManagerReviewItem[]} | AdminErrorBody;
};

export type AdminManagerMutationResult = {
  readonly status: number;
  readonly body: {
    readonly updated: true;
    readonly operationId: string;
    readonly auditState: "RECORDED" | "PENDING";
  } | AdminErrorBody;
};

export type AdminManagerDocumentResult = {
  readonly status: number;
  readonly body: AdminManagerDocument | AdminErrorBody;
};

export function parseManagerDocumentReasonBody(body: unknown): string {
  return isRecord(body) ? readString(body.reason) : "";
}

export async function handleListManagerReviews(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  dependencies: AdminManagerReviewDependencies,
): Promise<AdminManagerListResult> {
  const authorization = await authorizeOperations(authorizationHeader, appCheckHeader, dependencies, {
    action: "VIEW",
    resourceType: "MANAGER_REVIEW_LIST",
    resourceId: "all",
    reason: "허용되지 않은 관리자 역할",
  });
  if (!authorization.ok) return authorization.failure;
  // 감사 보정 실패가 운영 목록 자체를 막지 않도록 조회와 분리한다.
  try {
    await dependencies.reconcilePendingManagerReviewAudits();
  } catch {
    // 재처리 대상은 outbox에 남아 다음 요청에서 다시 시도한다.
  }
  try {
    const items = await dependencies.listManagerReviews();
    await dependencies.recordAdminAccessAudit({
      actorAdminUserId: authorization.actor.id,
      action: "VIEW",
      resourceType: "MANAGER_REVIEW_LIST",
      resourceId: "all",
      reason: "",
      outcome: "ALLOWED",
      metadata: {count: items.length},
    });
    return {status: 200, body: {items}};
  } catch {
    await recordFailedAudit(dependencies, authorization.actor.id, {
      action: "VIEW",
      resourceType: "MANAGER_REVIEW_LIST",
      resourceId: "all",
      reason: "",
    });
    return failure(503, "manager_reviews_lookup_failed", "매니저 심사 목록을 불러오지 못했습니다.");
  }
}

export async function handleSaveManagerReview(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  requestBody: unknown,
  dependencies: AdminManagerReviewDependencies,
): Promise<AdminManagerMutationResult> {
  const authorization = await authorizeOperations(authorizationHeader, appCheckHeader, dependencies, {
    action: "UPDATE",
    resourceType: "MANAGER_REVIEW",
    resourceId: isRecord(requestBody) ? readIdentifier(requestBody.managerUserId) || "invalid" : "invalid",
    reason: "허용되지 않은 관리자 역할",
  });
  if (!authorization.ok) return authorization.failure;
  const actorAdminRole = authorization.actor.adminRole;
  if (!actorAdminRole) {
    return failure(503, "admin_role_resolution_failed", "관리자 업무 역할을 확인하지 못했습니다.");
  }
  if (!isRecord(requestBody)) {
    const invalid = failure(400, "invalid_manager_review", "요청 본문은 JSON 객체여야 합니다.");
    return auditedManagerMutationFailure(
      dependencies, authorization.actor.id, "invalid", "DENIED", invalid,
    );
  }
  const managerUserId = readIdentifier(requestBody.managerUserId);
  const status = requestBody.status;
  const reviewNote = readString(requestBody.reviewNote);
  const operationId = readUuid(requestBody.operationId);
  const submissionRevision = readSubmissionRevision(requestBody.submissionRevision);
  if (!managerUserId || !operationId || !submissionRevision
      || (status !== "APPROVED" && status !== "REJECTED")) {
    const invalid = failure(400, "invalid_manager_review", "매니저 ID와 심사 상태를 확인해 주세요.");
    return auditedManagerMutationFailure(
      dependencies, authorization.actor.id, managerUserId || "invalid", "DENIED", invalid,
    );
  }
  if (status === "REJECTED" && !reviewNote) {
    const invalid = failure(400, "invalid_manager_review", "반려 사유를 입력해 주세요.");
    return auditedManagerMutationFailure(
      dependencies, authorization.actor.id, managerUserId, "DENIED", invalid,
    );
  }
  if (reviewNote.length > 500) {
    const invalid = failure(400, "invalid_manager_review", "심사 메모는 500자 이하여야 합니다.");
    return auditedManagerMutationFailure(
      dependencies, authorization.actor.id, managerUserId, "DENIED", invalid,
    );
  }
  let hmacKey: string;
  try {
    hmacKey = dependencies.getManagerReviewOutboxHmacKey();
  } catch {
    const unavailable = failure(
      503,
      "manager_review_outbox_key_unavailable",
      "매니저 심사 보안 설정을 확인하지 못해 요청을 중단했습니다.",
    );
    return auditedManagerMutationFailure(
      dependencies, authorization.actor.id, managerUserId, "FAILED", unavailable,
    );
  }
  let documentEvidence: readonly ManagerDocumentEvidence[] = [];
  if (status === "APPROVED") {
    try {
      documentEvidence = await dependencies.verifyManagerDocumentEvidenceTokens(
        readEvidenceTokens(requestBody.documentEvidenceTokens),
        authorization.actor.id,
        managerUserId,
        hmacKey,
      );
      if (documentEvidence.some((item) => item.submissionRevision !== submissionRevision)) {
        throw Object.assign(new Error("revision mismatch"), {code: "manager_document_evidence_stale"});
      }
    } catch (error) {
      const invalidEvidence = mapManagerDocumentEvidenceFailure(error);
      return auditedManagerMutationFailure(
        dependencies,
        authorization.actor.id,
        managerUserId,
        invalidEvidence.status === 503 ? "FAILED" : "DENIED",
        invalidEvidence,
      );
    }
  }
  const documentEvidenceDigest = managerDocumentEvidenceSetDigest(documentEvidence);
  let saveReceipt: {readonly auditState: "PENDING" | "DELIVERED"};
  try {
    saveReceipt = await dependencies.saveManagerReview(
      managerUserId,
      status,
      reviewNote,
      authorization.actor.id,
      actorAdminRole,
      operationId,
      hmacKey,
      documentEvidence,
      documentEvidenceDigest,
      submissionRevision,
    );
  } catch (error) {
    const mapped = mapManagerReviewSaveFailure(error);
    return auditedManagerMutationFailure(
      dependencies,
      authorization.actor.id,
      managerUserId,
      mapped.status === 503 ? "FAILED" : "DENIED",
      mapped,
    );
  }

  if (saveReceipt.auditState === "DELIVERED") {
    return {status: 200, body: {updated: true, operationId, auditState: "RECORDED"}};
  }

  try {
    const auditId = await dependencies.recordAdminAccessAudit(createManagerReviewAuditCommand({
      actorAdminUserId: authorization.actor.id,
      managerUserId,
      status,
      reviewNote,
      actorAdminRole,
      operationId,
      documentEvidenceDigest,
      submissionRevision,
    }, hmacKey));
    await dependencies.markManagerReviewAuditDelivered(operationId, auditId);
    return {status: 200, body: {updated: true, operationId, auditState: "RECORDED"}};
  } catch {
    return {status: 202, body: {updated: true, operationId, auditState: "PENDING"}};
  }
}

function mapManagerReviewSaveFailure(error: unknown): AdminManagerMutationResult {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code === "P0002") return failure(404, "manager_not_found", "매니저 계정을 찾지 못했습니다.");
  if (code === "P0001") return failure(409, "manager_review_not_ready", "제출 요약과 서류 상태를 확인해 주세요.");
  if (code === "P0003") return failure(409, "manager_review_operation_conflict", "같은 작업 번호의 심사 내용이 다릅니다.");
  if (code === "P0006") {
    return failure(
      409,
      "manager_document_deletion_in_progress",
      "증빙 원본 파기 절차가 진행 중입니다. 완료 후 다시 심사해 주세요.",
    );
  }
  if (code === "P0005") return failure(409, "manager_document_evidence_stale", "확인한 문서가 현재 제출 문서와 다릅니다. 세 문서를 다시 확인해 주세요.");
  if (code === "manager_review_not_pending") {
    return failure(409, "manager_review_not_pending", "이미 처리됐거나 심사 대기 상태가 아닌 제출입니다.");
  }
  if (code === "manager_document_revision_stale" || code === "manager_document_evidence_stale") {
    return failure(409, "manager_document_evidence_stale", "확인한 뒤 제출 상태 또는 문서가 변경되었습니다.");
  }
  return failure(503, "manager_review_save_failed", "매니저 심사 결과를 저장하지 못했습니다.");
}

function mapManagerDocumentEvidenceFailure(error: unknown): AdminManagerMutationResult {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code === "manager_document_evidence_expired") {
    return failure(409, "manager_document_evidence_expired", "문서 확인 시간이 만료되었습니다. 세 문서를 다시 확인해 주세요.");
  }
  if (code === "manager_document_evidence_incomplete") {
    return failure(409, "manager_document_evidence_incomplete", "승인 전에 세 문서를 모두 확인해 주세요.");
  }
  if (code === "P0005") {
    return failure(409, "manager_document_evidence_stale", "확인한 뒤 문서가 변경되었습니다. 세 문서를 다시 확인해 주세요.");
  }
  if (code === "invalid_manager_document_evidence" || code === "manager_document_evidence_scope_mismatch") {
    return failure(409, "manager_document_evidence_invalid", "문서 확인 증거가 올바르지 않습니다. 세 문서를 다시 확인해 주세요.");
  }
  return failure(503, "manager_document_evidence_verification_failed", "현재 제출 문서를 다시 확인하지 못했습니다.");
}

async function auditedManagerMutationFailure(
  dependencies: AdminManagerReviewDependencies,
  actorAdminUserId: string,
  managerUserId: string,
  outcome: "DENIED" | "FAILED",
  originalFailure: AdminManagerMutationResult,
): Promise<AdminManagerMutationResult> {
  const auditRecorded = outcome === "DENIED"
    ? await recordDeniedAudit(dependencies, actorAdminUserId, {
        action: "UPDATE",
        resourceType: "MANAGER_REVIEW",
        resourceId: managerUserId,
        reason: "매니저 심사 요청이 거부되었습니다.",
        metadata: {failureCode: "error" in originalFailure.body ? originalFailure.body.error : "unknown"},
      })
    : await recordFailedAudit(dependencies, actorAdminUserId, {
        action: "UPDATE",
        resourceType: "MANAGER_REVIEW",
        resourceId: managerUserId,
        reason: "매니저 심사 저장에 실패했습니다.",
        metadata: {failureCode: "error" in originalFailure.body ? originalFailure.body.error : "unknown"},
      });
  return auditRecorded
    ? originalFailure
    : failure(503, "admin_audit_failed", "관리자 감사 기록을 남기지 못해 요청을 중단했습니다.");
}

export async function handleLoadManagerDocument(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  managerUserIdValue: unknown,
  documentKeyValue: unknown,
  reasonValue: unknown,
  dependencies: AdminManagerReviewDependencies,
): Promise<AdminManagerDocumentResult> {
  const requestedManagerId = readIdentifier(managerUserIdValue);
  const requestedDocumentKey = readDocumentKey(documentKeyValue);
  const requestedReason = readString(reasonValue);
  const authorization = await authorizeOperations(authorizationHeader, appCheckHeader, dependencies, {
    action: "RAW_VIEW",
    resourceType: "MANAGER_DOCUMENT",
    resourceId: requestedManagerId && requestedDocumentKey
      ? `${requestedManagerId}:${requestedDocumentKey}`
      : "invalid",
    reason: "원문 조회 권한이 허용되지 않았습니다.",
  });
  if (!authorization.ok) return authorization.failure;
  const managerUserId = requestedManagerId;
  const documentKey = requestedDocumentKey;
  const reason = requestedReason;
  if (!managerUserId || !documentKey || reason.length < 10 || reason.length > 500) {
    const auditRecorded = await recordDeniedAudit(dependencies, authorization.actor.id, {
      action: "RAW_VIEW",
      resourceType: "MANAGER_DOCUMENT",
      resourceId: managerUserId && documentKey ? `${managerUserId}:${documentKey}` : "invalid",
      reason: "원문 조회 요청 형식 검증에 실패했습니다.",
      metadata: {failureCode: "invalid_manager_document_request"},
    });
    if (!auditRecorded) {
      return failure(503, "admin_audit_failed", "거부 감사 기록을 남기지 못해 요청을 중단했습니다.");
    }
    return failure(400, "invalid_manager_document_request", "매니저, 문서 종류와 10~500자 조회 사유를 확인해 주세요.");
  }
  let hmacKey: string;
  try {
    hmacKey = dependencies.getManagerReviewOutboxHmacKey();
  } catch {
    const auditRecorded = await recordFailedAudit(dependencies, authorization.actor.id, {
      action: "RAW_VIEW",
      resourceType: "MANAGER_DOCUMENT",
      resourceId: `${managerUserId}:${documentKey}`,
      reason,
      metadata: {failureCode: "manager_document_evidence_key_unavailable"},
    });
    return auditRecorded
      ? failure(503, "manager_document_evidence_key_unavailable", "문서 확인 보안 설정을 확인하지 못했습니다.")
      : failure(503, "admin_audit_failed", "조회 실패 감사 기록을 남기지 못해 요청을 중단했습니다.");
  }
  try {
    const document = await dependencies.loadManagerDocument(
      managerUserId,
      documentKey,
      authorization.actor.id,
      hmacKey,
    );
    if (!document) {
      const auditRecorded = await recordFailedAudit(dependencies, authorization.actor.id, {
        action: "RAW_VIEW",
        resourceType: "MANAGER_DOCUMENT",
        resourceId: `${managerUserId}:${documentKey}`,
        reason,
      });
      if (!auditRecorded) {
        return failure(503, "admin_audit_failed", "조회 실패 감사 기록을 남기지 못해 요청을 중단했습니다.");
      }
      return failure(404, "manager_document_not_found", "제출된 원본 문서를 찾지 못했습니다.");
    }
    await dependencies.recordAdminAccessAudit({
      actorAdminUserId: authorization.actor.id,
      action: "RAW_VIEW",
      resourceType: "MANAGER_DOCUMENT",
      resourceId: `${managerUserId}:${documentKey}`,
      reason,
      outcome: "ALLOWED",
      metadata: {contentType: document.contentType},
    });
    return {status: 200, body: document};
  } catch (error) {
    const auditRecorded = await recordFailedAudit(dependencies, authorization.actor.id, {
      action: "RAW_VIEW",
      resourceType: "MANAGER_DOCUMENT",
      resourceId: `${managerUserId}:${documentKey}`,
      reason,
      metadata: {
        failureCode: isRecord(error) && typeof error.code === "string" ? error.code : "unknown",
      },
    });
    if (!auditRecorded) {
      return failure(503, "admin_audit_failed", "조회 실패 감사 기록을 남기지 못해 요청을 중단했습니다.");
    }
    if (isRecord(error) && error.code === "P0004") {
      return failure(415, "unsupported_manager_document_type", "미리보기를 지원하지 않는 문서 형식입니다.");
    }
    return failure(503, "manager_document_lookup_failed", "원본 문서를 안전하게 불러오지 못했습니다.");
  }
}

async function authorizeOperations(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  dependencies: AdminManagerReviewDependencies,
  deniedCommand: Omit<AdminAuditCommand, "actorAdminUserId" | "outcome">,
) {
  const authorization = await authorizeAdmin(authorizationHeader, appCheckHeader, dependencies);
  if (!authorization.ok) return authorization;
  const roleFailure = requireAdminRole(authorization.actor, ["SUPER_ADMIN", "OPERATIONS"]);
  if (!roleFailure) return authorization;
  try {
    await dependencies.recordAdminAccessAudit({
      ...deniedCommand,
      actorAdminUserId: authorization.actor.id,
      outcome: "DENIED",
    });
  } catch {
    return {ok: false as const, failure: failure(
      503, "admin_audit_failed", "권한 거부 감사 기록을 남기지 못해 요청을 중단했습니다.",
    )};
  }
  return {ok: false as const, failure: roleFailure};
}

async function recordDeniedAudit(
  dependencies: AdminManagerReviewDependencies,
  actorAdminUserId: string,
  command: Omit<AdminAuditCommand, "actorAdminUserId" | "outcome">,
): Promise<boolean> {
  try {
    await dependencies.recordAdminAccessAudit({...command, actorAdminUserId, outcome: "DENIED"});
    return true;
  } catch {
    return false;
  }
}

async function recordFailedAudit(
  dependencies: AdminManagerReviewDependencies,
  actorAdminUserId: string,
  command: Omit<AdminAuditCommand, "actorAdminUserId" | "outcome">,
): Promise<boolean> {
  try {
    await dependencies.recordAdminAccessAudit({...command, actorAdminUserId, outcome: "FAILED"});
    return true;
  } catch {
    return false;
  }
}

function readDocumentKey(value: unknown): ManagerDocumentKey | null {
  return value === "idCard" || value === "license" || value === "criminalRecord" ? value : null;
}

function readIdentifier(value: unknown): string {
  const identifier = readString(value);
  return /^[a-z0-9._-]{1,128}$/iu.test(identifier) ? identifier : "";
}

function readUuid(value: unknown): string {
  const identifier = readString(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(identifier)
    ? identifier
    : "";
}

function readEvidenceTokens(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length !== 3) return [];
  const tokens = value.map((item) => typeof item === "string" ? item.trim() : "");
  return tokens.every((token) => token.length > 0 && token.length <= 4096) ? tokens : [];
}

function readSubmissionRevision(value: unknown): string {
  const revision = readString(value);
  return /^ts:[0-9]{1,12}:[0-9]{9}$/u.test(revision) ? revision : "";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function failure(status: number, error: string, message: string) {
  return {status, body: {error, message}};
}
