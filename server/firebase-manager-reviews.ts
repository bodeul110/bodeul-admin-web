import "server-only";

import {createHash} from "node:crypto";
import {FieldValue, getFirestore, Timestamp, type DocumentData} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";

import {getFirebaseAdminApp} from "./firebase-admin";
import type {
  AdminManagerDocument,
  AdminManagerReviewItem,
  ManagerDocumentKey,
} from "./admin-manager-reviews";
import type {AdminDetailRole} from "./admin-auth";
import {
  documentStorageKeys,
  isAllowedManagerDocumentStoragePath,
} from "./manager-document-storage-path";
import {normalizeInlineManagerDocumentContentType} from "./manager-document-response";
import {
  createManagerDocumentEvidenceToken,
  managerDocumentEvidenceSetDigest,
  managerDocumentStoragePathDigest,
  verifyManagerDocumentEvidenceSet,
  type ManagerDocumentEvidence,
} from "./manager-document-evidence";
import {
  createManagerDocumentPreview,
  detectManagerDocumentContentType,
} from "./manager-document-preview";
import type {AdminAuditCommand} from "./postgres";
import {createManagerReviewAuditCommand} from "./manager-review-audit";
import {
  managerReviewAuditTombstoneExpiresAt,
  managerReviewOperationHash,
  matchesManagerReviewOperation,
  processPendingAuditOutbox,
  type PendingAuditOutboxItem,
} from "./manager-review-outbox";

const MANAGER_DOCUMENT_KEYS: readonly ManagerDocumentKey[] = ["idCard", "license", "criminalRecord"];

export async function listManagerReviews(): Promise<readonly AdminManagerReviewItem[]> {
  const snapshot = await getFirestore(getFirebaseAdminApp())
    .collection("users")
    .where("role", "==", "MANAGER")
    .get();

  return snapshot.docs
    .map((document) => toManagerReviewItem(document.id, document.data()))
    .sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
}

export async function saveManagerReview(
  managerUserId: string,
  status: "APPROVED" | "REJECTED",
  reviewNote: string,
  actorAdminUserId: string,
  actorAdminRole: AdminDetailRole,
  operationId: string,
  hmacKey: string,
  documentEvidence: readonly ManagerDocumentEvidence[],
  documentEvidenceDigest: string,
): Promise<{readonly auditState: "PENDING" | "DELIVERED"}> {
  const evidenceKeys = new Set(documentEvidence.map((item) => item.documentKey));
  if (managerDocumentEvidenceSetDigest(documentEvidence) !== documentEvidenceDigest
      || (status === "APPROVED" && documentEvidence.length !== MANAGER_DOCUMENT_KEYS.length)
      || (status === "APPROVED" && (
        evidenceKeys.size !== MANAGER_DOCUMENT_KEYS.length
        || MANAGER_DOCUMENT_KEYS.some((key) => !evidenceKeys.has(key))
      ))
      || (status === "REJECTED" && documentEvidence.length !== 0)) {
    throw codedError("P0005", "문서 확인 증거가 심사 요청과 일치하지 않습니다.");
  }
  const operationPayload = {
    managerUserId,
    status,
    reviewNote,
    actorAdminUserId,
    actorAdminRole,
    documentEvidenceDigest,
  };
  const payloadHash = managerReviewOperationHash(operationPayload, hmacKey);
  const firestore = getFirestore(getFirebaseAdminApp());
  const reference = firestore.collection("users").doc(managerUserId);
  const outboxReference = firestore.collection("adminAuditOutbox").doc(operationId);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const outboxSnapshot = await transaction.get(outboxReference);
    if (outboxSnapshot.exists) {
      const existing = outboxSnapshot.data() || {};
      if (!matchesManagerReviewOperation(existing, operationPayload, hmacKey)) {
        throw codedError("P0003", "같은 작업 번호의 심사 내용이 다릅니다.");
      }
      return {auditState: existing.state === "DELIVERED" ? "DELIVERED" as const : "PENDING" as const};
    }
    if (!snapshot.exists || snapshot.data()?.role !== "MANAGER") {
      throw codedError("P0002", "매니저 계정을 찾지 못했습니다.");
    }
    const data = snapshot.data() || {};
    if (!readText(data.managerDocumentSummary)) {
      throw codedError("P0001", "제출 요약이 없습니다.");
    }
    if (status === "APPROVED") {
      for (const evidence of documentEvidence) {
        const currentPath = resolveDocumentPath(data, managerUserId, evidence.documentKey);
        if (evidence.actorAdminUserId !== actorAdminUserId
            || evidence.managerUserId !== managerUserId
            || !currentPath
            || managerDocumentStoragePathDigest(currentPath, hmacKey) !== evidence.storagePathDigest) {
          throw codedError("P0005", "현재 제출 문서가 확인한 문서와 다릅니다.");
        }
      }
    }
    transaction.update(reference, {
      managerDocumentStatus: status,
      managerDocumentReviewNote: status === "REJECTED" ? reviewNote : "",
      managerDocumentReviewedAt: FieldValue.serverTimestamp(),
      managerDocumentReviewedByAdminUserId: actorAdminUserId,
      managerDocumentHistory: FieldValue.arrayUnion({
        eventType: status,
        happenedAt: Date.now(),
        actorAdminUserId,
        operationId,
        reviewNote: status === "REJECTED" ? reviewNote : "",
        documentEvidenceDigest,
      }),
    });
    transaction.create(outboxReference, {
      operationId,
      payloadHash,
      state: "PENDING",
      actorAdminUserId,
      actorAdminRole,
      action: "UPDATE",
      resourceType: "MANAGER_REVIEW",
      resourceId: managerUserId,
      reason: reviewNote,
      outcome: "ALLOWED",
      metadata: {status, operationId, documentEvidenceDigest},
      managerUserId,
      status,
      reviewNote,
      documentEvidenceDigest,
      createdAt: FieldValue.serverTimestamp(),
      deliveredAt: null,
      expiresAt: null,
      postgresAuditId: null,
    });
    return {auditState: "PENDING" as const};
  });
}

export async function markManagerReviewAuditDelivered(
  operationId: string,
  auditId: string,
): Promise<void> {
  await getFirestore(getFirebaseAdminApp()).collection("adminAuditOutbox").doc(operationId).update({
    state: "DELIVERED",
    postgresAuditId: auditId,
    deliveredAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(managerReviewAuditTombstoneExpiresAt(Date.now())),
    actorAdminUserId: FieldValue.delete(),
    actorAdminRole: FieldValue.delete(),
    action: FieldValue.delete(),
    resourceType: FieldValue.delete(),
    resourceId: FieldValue.delete(),
    reason: FieldValue.delete(),
    outcome: FieldValue.delete(),
    metadata: FieldValue.delete(),
    managerUserId: FieldValue.delete(),
    status: FieldValue.delete(),
    reviewNote: FieldValue.delete(),
    documentEvidenceDigest: FieldValue.delete(),
  });
}

export async function reconcilePendingManagerReviewAudits(
  recordAudit: (command: AdminAuditCommand) => Promise<string>,
  hmacKey: string,
): Promise<number> {
  const firestore = getFirestore(getFirebaseAdminApp());
  const outbox = firestore.collection("adminAuditOutbox");
  await cleanupDeliveredManagerReviewAuditOutbox(firestore, outbox);
  const snapshot = await outbox
    .where("state", "==", "PENDING")
    .limit(10)
    .get();
  return processPendingAuditOutbox(
    snapshot.docs.map((document) => ({id: document.id, data: document.data()})),
    (item) => auditCommandFromOutbox(item, hmacKey),
    recordAudit,
    markManagerReviewAuditDelivered,
    (operationId) => {
      console.warn("관리자 감사 outbox 항목 재처리에 실패했습니다.", {
        operationId: isUuid(operationId) ? operationId : "invalid",
      });
    },
  );
}

async function cleanupDeliveredManagerReviewAuditOutbox(
  firestore: ReturnType<typeof getFirestore>,
  outbox: ReturnType<ReturnType<typeof getFirestore>["collection"]>,
): Promise<void> {
  const expired = await outbox.where("expiresAt", "<=", Timestamp.now()).limit(50).get();
  const batch = firestore.batch();
  let deleted = 0;
  expired.docs.forEach((document) => {
    if (document.data().state !== "DELIVERED") return;
    batch.delete(document.ref);
    deleted += 1;
  });
  if (deleted > 0) await batch.commit();
}

export async function loadManagerDocument(
  managerUserId: string,
  documentKey: ManagerDocumentKey,
  actorAdminUserId: string,
  hmacKey: string,
): Promise<AdminManagerDocument | null> {
  const userSnapshot = await getFirestore(getFirebaseAdminApp())
    .collection("users")
    .doc(managerUserId)
    .get();
  if (!userSnapshot.exists || userSnapshot.data()?.role !== "MANAGER") {
    return null;
  }

  const data = userSnapshot.data() || {};
  const explicitPath = resolveDocumentPath(data, managerUserId, documentKey);
  if (!explicitPath) {
    return null;
  }
  const bucket = getStorage(getFirebaseAdminApp()).bucket();
  const file = bucket.file(explicitPath);

  const [exists] = await file.exists();
  if (!exists) {
    return null;
  }
  const [metadata] = await file.getMetadata();
  const generation = readText(metadata.generation);
  const contentType = normalizeInlineManagerDocumentContentType(readText(metadata.contentType));
  const size = Number(metadata.size || 0);
  if (!contentType || !/^[1-9][0-9]{0,30}$/u.test(generation)) {
    throw codedError("P0004", "허용하지 않는 매니저 문서 형식입니다.");
  }
  if (!Number.isFinite(size) || size < 1 || size > 10 * 1024 * 1024) {
    throw new Error("허용하지 않는 매니저 문서 형식 또는 크기입니다.");
  }
  const generationFile = bucket.file(explicitPath, {generation});
  const [bytes] = await generationFile.download();
  const sourceBytes = new Uint8Array(bytes);
  const digest = createHash("sha256").update(sourceBytes).digest("hex");
  const preview = await createManagerDocumentPreview(
    sourceBytes,
    contentType,
    `BoDeul Preview | ${actorAdminUserId.slice(0, 8)} | ${managerUserId.slice(0, 24)} | ${documentKey}`,
  );
  const {token: evidenceToken} = createManagerDocumentEvidenceToken({
    actorAdminUserId,
    managerUserId,
    documentKey,
    storagePathDigest: managerDocumentStoragePathDigest(explicitPath, hmacKey),
    generation,
    digest,
    contentType,
  }, hmacKey);
  return {
    bytes: preview.bytes,
    contentType: preview.contentType,
    updatedAt: readText(metadata.updated) || readText(metadata.timeCreated),
    evidenceToken,
  };
}

export async function verifyManagerDocumentEvidenceTokens(
  tokens: readonly string[],
  actorAdminUserId: string,
  managerUserId: string,
  hmacKey: string,
): Promise<readonly ManagerDocumentEvidence[]> {
  const evidence = verifyManagerDocumentEvidenceSet(tokens, hmacKey, {actorAdminUserId, managerUserId});
  const userSnapshot = await getFirestore(getFirebaseAdminApp()).collection("users").doc(managerUserId).get();
  if (!userSnapshot.exists || userSnapshot.data()?.role !== "MANAGER") {
    throw codedError("P0005", "매니저 계정을 찾지 못했습니다.");
  }
  const data = userSnapshot.data() || {};
  await Promise.all(evidence.map(async (item) => {
    const storagePath = resolveDocumentPath(data, managerUserId, item.documentKey);
    if (!storagePath || managerDocumentStoragePathDigest(storagePath, hmacKey) !== item.storagePathDigest) {
      throw codedError("P0005", "확인한 뒤 제출 문서 포인터가 변경되었습니다.");
    }
    await assertCurrentStorageEvidence(item, storagePath);
  }));
  return evidence;
}

async function assertCurrentStorageEvidence(
  evidence: ManagerDocumentEvidence,
  storagePath: string,
): Promise<void> {
  if (!isAllowedManagerDocumentStoragePath(
    evidence.managerUserId,
    evidence.documentKey,
    storagePath,
  )) {
    throw codedError("P0005", "문서 확인 증거의 저장 경로가 올바르지 않습니다.");
  }
  try {
    const bucket = getStorage(getFirebaseAdminApp()).bucket();
    const currentFile = bucket.file(storagePath);
    const [currentMetadata] = await currentFile.getMetadata();
    if (readText(currentMetadata.generation) !== evidence.generation
        || normalizeInlineManagerDocumentContentType(readText(currentMetadata.contentType)) !== evidence.contentType) {
      throw codedError("P0005", "확인한 뒤 제출 문서가 변경되었습니다.");
    }
    const size = Number(currentMetadata.size || 0);
    if (!Number.isFinite(size) || size < 1 || size > 10 * 1024 * 1024) {
      throw codedError("P0005", "현재 제출 문서의 크기가 허용 범위를 벗어났습니다.");
    }
    const [bytes] = await bucket.file(storagePath, {generation: evidence.generation}).download();
    const actualBytes = new Uint8Array(bytes);
    const actualContentType = await detectManagerDocumentContentType(actualBytes);
    const actualDigest = createHash("sha256").update(actualBytes).digest("hex");
    if (actualContentType !== evidence.contentType || actualDigest !== evidence.digest) {
      throw codedError("P0005", "확인한 문서와 현재 제출 문서가 다릅니다.");
    }
  } catch (error) {
    if (hasErrorCode(error, "P0005")) throw error;
    if (hasErrorCode(error, "P0004") || isStorageVersionMismatchError(error)) {
      throw codedError("P0005", "현재 제출 문서 버전을 확인하지 못했습니다.");
    }
    throw error;
  }
}

function toManagerReviewItem(id: string, data: DocumentData): AdminManagerReviewItem {
  const documentPaths = MANAGER_DOCUMENT_KEYS
    .filter((key) => Boolean(resolveDocumentPath(data, id, key)));
  const status = data.managerDocumentStatus === "PENDING_REVIEW"
    || data.managerDocumentStatus === "APPROVED"
    || data.managerDocumentStatus === "REJECTED"
    ? data.managerDocumentStatus
    : "PENDING";
  return {
    id,
    name: maskName(readText(data.name) || "이름 없음"),
    maskedEmail: maskEmail(readText(data.email)),
    maskedPhone: maskPhone(readText(data.phone)),
    createdAt: timestampString(data.createdAt),
    status,
    documentSummary: readText(data.managerDocumentSummary),
    reviewNote: readText(data.managerDocumentReviewNote),
    availableDocumentKeys: documentPaths,
  };
}

function resolveDocumentPath(
  data: DocumentData,
  managerUserId: string,
  documentKey: ManagerDocumentKey,
): string {
  const maps = [data.managerDocumentFiles, data.managerDocumentFilePaths];
  for (const map of maps) {
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const storageKey of documentStorageKeys(documentKey)) {
      const path = pathFromValue((map as Record<string, unknown>)[storageKey]);
      if (isAllowedManagerDocumentStoragePath(managerUserId, documentKey, path)) return path;
    }
  }
  const legacyFields: Record<ManagerDocumentKey, readonly unknown[]> = {
    idCard: [data.managerIdCardFilePath, data.idCardFilePath, data.managerIdCardStoragePath],
    license: [
      data.managerLicenseFilePath, data.licenseFilePath, data.managerLicenseStoragePath,
      data.managerHealthCertificateFilePath, data.healthCertificateFilePath,
      data.managerHealthCertificateStoragePath,
    ],
    criminalRecord: [
      data.managerCriminalRecordFilePath, data.criminalRecordFilePath,
      data.managerCriminalRecordStoragePath,
    ],
  };
  return legacyFields[documentKey]
    .map(pathFromValue)
    .find((path) => isAllowedManagerDocumentStoragePath(managerUserId, documentKey, path)) || "";
}

function pathFromValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return readText(record.fullPath || record.path || record.storagePath);
}

function maskName(value: string): string {
  if (value.length <= 1) return "*";
  if (value.length === 2) return `${value[0]}*`;
  return `${value[0]}${"*".repeat(Math.min(value.length - 2, 3))}${value[value.length - 1]}`;
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "-";
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 7 ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : "-";
}

function timestampString(value: unknown): string {
  if (value && typeof value === "object" && "toDate" in value
      && typeof (value as {toDate: () => Date}).toDate === "function") {
    return (value as {toDate: () => Date}).toDate().toISOString();
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  return "";
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function auditCommandFromOutbox(
  item: PendingAuditOutboxItem,
  hmacKey: string,
): AdminAuditCommand {
  const data = item.data as DocumentData;
  const actorAdminUserId = readText(data.actorAdminUserId);
  const actorAdminRole = readText(data.actorAdminRole);
  const resourceId = readText(data.resourceId);
  const status = readText(data.status);
  const operationId = readText(data.operationId);
  const documentEvidenceDigest = readText(data.documentEvidenceDigest);
  const operationPayload = {
    managerUserId: resourceId,
    status: status === "REJECTED" ? "REJECTED" as const : "APPROVED" as const,
    reviewNote: readText(data.reason),
    actorAdminUserId,
    actorAdminRole: actorAdminRole === "SUPER_ADMIN" ? "SUPER_ADMIN" as const : "OPERATIONS" as const,
    documentEvidenceDigest,
  };
  if (!actorAdminUserId || !resourceId || !isUuid(item.id) || operationId !== item.id
      || (actorAdminRole !== "SUPER_ADMIN" && actorAdminRole !== "OPERATIONS")
      || (status !== "APPROVED" && status !== "REJECTED")
      || !/^[0-9a-f]{64}$/u.test(documentEvidenceDigest)
      || !matchesManagerReviewOperation(data, operationPayload, hmacKey)) {
    throw new Error("관리자 감사 outbox 항목이 올바르지 않습니다.");
  }
  return createManagerReviewAuditCommand({
    actorAdminUserId,
    managerUserId: resourceId,
    status,
    reviewNote: operationPayload.reviewNote,
    actorAdminRole: operationPayload.actorAdminRole,
    operationId,
    documentEvidenceDigest,
  }, hmacKey);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function codedError(code: string, message: string): Error & {code: string} {
  return Object.assign(new Error(message), {code});
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error
    && (error as {readonly code?: unknown}).code === code;
}

function isStorageVersionMismatchError(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as {readonly code?: unknown}).code;
  return code === 404 || code === 412 || code === "404" || code === "412";
}
