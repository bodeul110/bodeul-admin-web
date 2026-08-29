import "server-only";

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
): Promise<{readonly auditState: "PENDING" | "DELIVERED"}> {
  const firestore = getFirestore(getFirebaseAdminApp());
  const reference = firestore.collection("users").doc(managerUserId);
  const outboxReference = firestore.collection("adminAuditOutbox").doc(operationId);
  const operationPayload = {managerUserId, status, reviewNote, actorAdminUserId, actorAdminRole};
  const payloadHash = managerReviewOperationHash(operationPayload);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const outboxSnapshot = await transaction.get(outboxReference);
    if (outboxSnapshot.exists) {
      const existing = outboxSnapshot.data() || {};
      if (!matchesManagerReviewOperation(existing, operationPayload)) {
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
      metadata: {status, operationId},
      managerUserId,
      status,
      reviewNote,
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
  });
}

export async function reconcilePendingManagerReviewAudits(
  recordAudit: (command: AdminAuditCommand) => Promise<string>,
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
    auditCommandFromOutbox,
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
  const bucket = getStorage(getFirebaseAdminApp()).bucket();
  const file = explicitPath
    ? bucket.file(explicitPath)
    : await findNewestDocumentFile(managerUserId, documentKey);
  if (!file) {
    return null;
  }

  const [exists] = await file.exists();
  if (!exists) {
    return null;
  }
  const [metadata] = await file.getMetadata();
  const contentType = normalizeInlineManagerDocumentContentType(readText(metadata.contentType));
  const size = Number(metadata.size || 0);
  if (!contentType) {
    throw codedError("P0004", "허용하지 않는 매니저 문서 형식입니다.");
  }
  if (!Number.isFinite(size) || size < 1 || size > 10 * 1024 * 1024) {
    throw new Error("허용하지 않는 매니저 문서 형식 또는 크기입니다.");
  }
  const [bytes] = await file.download();
  return {
    bytes: new Uint8Array(bytes),
    fileName: file.name.split("/").pop() || documentKey,
    contentType,
    updatedAt: readText(metadata.updated) || readText(metadata.timeCreated),
  };
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

async function findNewestDocumentFile(managerUserId: string, documentKey: ManagerDocumentKey) {
  const bucket = getStorage(getFirebaseAdminApp()).bucket();
  const candidates = [];
  for (const storageKey of documentStorageKeys(documentKey)) {
    const [files] = await bucket.getFiles({prefix: `manager-documents/${managerUserId}/${storageKey}/`});
    candidates.push(...files.filter((file) =>
      isAllowedManagerDocumentStoragePath(managerUserId, documentKey, file.name)));
  }
  if (!candidates.length) return null;
  const withMetadata = await Promise.all(candidates.map(async (file) => {
    const [metadata] = await file.getMetadata();
    return {file, updated: Date.parse(readText(metadata.updated) || readText(metadata.timeCreated)) || 0};
  }));
  withMetadata.sort((left, right) => right.updated - left.updated);
  return withMetadata[0]?.file || null;
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

function auditCommandFromOutbox(item: PendingAuditOutboxItem): AdminAuditCommand {
  const data = item.data as DocumentData;
  const actorAdminUserId = readText(data.actorAdminUserId);
  const actorAdminRole = readText(data.actorAdminRole);
  const resourceId = readText(data.resourceId);
  const status = readText(data.status);
  const operationId = readText(data.operationId);
  const operationPayload = {
    managerUserId: resourceId,
    status: status === "REJECTED" ? "REJECTED" as const : "APPROVED" as const,
    reviewNote: readText(data.reason),
    actorAdminUserId,
    actorAdminRole: actorAdminRole === "SUPER_ADMIN" ? "SUPER_ADMIN" as const : "OPERATIONS" as const,
  };
  if (!actorAdminUserId || !resourceId || !isUuid(item.id) || operationId !== item.id
      || (actorAdminRole !== "SUPER_ADMIN" && actorAdminRole !== "OPERATIONS")
      || (status !== "APPROVED" && status !== "REJECTED")
      || !matchesManagerReviewOperation(data, operationPayload)) {
    throw new Error("관리자 감사 outbox 항목이 올바르지 않습니다.");
  }
  return createManagerReviewAuditCommand({
    actorAdminUserId,
    managerUserId: resourceId,
    status,
    reviewNote: operationPayload.reviewNote,
    actorAdminRole: operationPayload.actorAdminRole,
    operationId,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function codedError(code: string, message: string): Error & {code: string} {
  return Object.assign(new Error(message), {code});
}
