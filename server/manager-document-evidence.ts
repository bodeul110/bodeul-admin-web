import {createHash, createHmac, timingSafeEqual} from "node:crypto";

import type {ManagerDocumentKey} from "./admin-manager-reviews.ts";
import {requireManagerReviewOutboxHmacKey} from "./manager-review-outbox.ts";

const EVIDENCE_TOKEN_DOMAIN = "bodeul:manager-document-evidence:v1\0";
const EVIDENCE_SET_DOMAIN = "bodeul:manager-document-evidence-set:v1\0";
const STORAGE_PATH_DOMAIN = "bodeul:manager-document-storage-path:v1\0";
const EVIDENCE_TOKEN_VERSION = 1;
const EVIDENCE_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;

export type ManagerDocumentEvidence = {
  readonly version: 1;
  readonly actorAdminUserId: string;
  readonly managerUserId: string;
  readonly documentKey: ManagerDocumentKey;
  readonly storagePathDigest: string;
  readonly generation: string;
  readonly digest: string;
  readonly contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  readonly submissionRevision: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
};

type EvidenceSource = Omit<ManagerDocumentEvidence, "version" | "issuedAt" | "expiresAt">;

export function createManagerDocumentEvidenceToken(
  source: EvidenceSource,
  hmacKey: string,
  now = Date.now(),
): {readonly token: string; readonly evidence: ManagerDocumentEvidence} {
  const evidence: ManagerDocumentEvidence = {
    version: EVIDENCE_TOKEN_VERSION,
    ...source,
    issuedAt: now,
    expiresAt: now + EVIDENCE_TOKEN_TTL_MS,
  };
  assertEvidenceShape(evidence);
  const payload = Buffer.from(JSON.stringify(evidence), "utf8").toString("base64url");
  const signature = evidenceSignature(payload, hmacKey);
  return {token: `v1.${payload}.${signature}`, evidence};
}

export function verifyManagerDocumentEvidenceToken(
  token: string,
  hmacKey: string,
  expected: {readonly actorAdminUserId: string; readonly managerUserId: string},
  now = Date.now(),
): ManagerDocumentEvidence {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !/^[0-9a-f]{64}$/u.test(parts[2] || "")) {
    throw evidenceError("invalid_manager_document_evidence", "문서 확인 증거 형식이 올바르지 않습니다.");
  }
  const expectedSignature = evidenceSignature(parts[1], hmacKey);
  if (!timingSafeEqual(Buffer.from(parts[2], "hex"), Buffer.from(expectedSignature, "hex"))) {
    throw evidenceError("invalid_manager_document_evidence", "문서 확인 증거 서명을 확인하지 못했습니다.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw evidenceError("invalid_manager_document_evidence", "문서 확인 증거를 해석하지 못했습니다.");
  }
  assertEvidenceShape(parsed);
  if (parsed.actorAdminUserId !== expected.actorAdminUserId || parsed.managerUserId !== expected.managerUserId) {
    throw evidenceError("manager_document_evidence_scope_mismatch", "다른 관리자 또는 매니저의 문서 확인 증거입니다.");
  }
  if (parsed.issuedAt > now + MAX_CLOCK_SKEW_MS || parsed.expiresAt <= now
      || parsed.expiresAt - parsed.issuedAt !== EVIDENCE_TOKEN_TTL_MS) {
    throw evidenceError("manager_document_evidence_expired", "문서 확인 증거가 만료되었습니다.");
  }
  return parsed;
}

export function verifyManagerDocumentEvidenceSet(
  tokens: readonly string[],
  hmacKey: string,
  expected: {readonly actorAdminUserId: string; readonly managerUserId: string},
  now = Date.now(),
): readonly ManagerDocumentEvidence[] {
  if (tokens.length !== 1) {
    throw evidenceError("manager_document_evidence_incomplete", "현재 자격 증빙의 문서 확인 증거 하나가 필요합니다.");
  }
  const evidence = tokens.map((token) => verifyManagerDocumentEvidenceToken(token, hmacKey, expected, now));
  return evidence;
}

export function managerDocumentEvidenceSetDigest(
  evidence: readonly ManagerDocumentEvidence[],
): string {
  const normalized = [...evidence]
    .sort((left, right) => left.documentKey.localeCompare(right.documentKey))
    .map((item) => [
      item.documentKey,
      item.storagePathDigest,
      item.generation,
      item.digest,
      item.contentType,
      item.submissionRevision,
    ]);
  return createHash("sha256")
    .update(EVIDENCE_SET_DOMAIN)
    .update(JSON.stringify(normalized))
    .digest("hex");
}

export function managerDocumentStoragePathDigest(storagePath: string, hmacKey: string): string {
  if (!storagePath.trim()) {
    throw evidenceError("invalid_manager_document_evidence", "문서 저장 경로가 비어 있습니다.");
  }
  return createHmac("sha256", requireManagerReviewOutboxHmacKey(hmacKey))
    .update(STORAGE_PATH_DOMAIN)
    .update(storagePath)
    .digest("hex");
}

function evidenceSignature(payload: string, hmacKey: string): string {
  return createHmac("sha256", requireManagerReviewOutboxHmacKey(hmacKey))
    .update(EVIDENCE_TOKEN_DOMAIN)
    .update(payload)
    .digest("hex");
}

function assertEvidenceShape(value: unknown): asserts value is ManagerDocumentEvidence {
  if (!isRecord(value)
      || value.version !== EVIDENCE_TOKEN_VERSION
      || !UUID_PATTERN.test(readText(value.actorAdminUserId))
      || !MANAGER_ID_PATTERN.test(readText(value.managerUserId))
      || !isDocumentKey(value.documentKey)
      || !DIGEST_PATTERN.test(readText(value.storagePathDigest))
      || !GENERATION_PATTERN.test(readText(value.generation))
      || !DIGEST_PATTERN.test(readText(value.digest))
      || !isContentType(value.contentType)
      || !SUBMISSION_REVISION_PATTERN.test(readText(value.submissionRevision))
      || !Number.isSafeInteger(value.issuedAt)
      || !Number.isSafeInteger(value.expiresAt)) {
    throw evidenceError("invalid_manager_document_evidence", "문서 확인 증거 내용이 올바르지 않습니다.");
  }
}

function isDocumentKey(value: unknown): value is ManagerDocumentKey {
  return value === "license" || value === "nursingLicense";
}

function isContentType(value: unknown): value is ManagerDocumentEvidence["contentType"] {
  return value === "application/pdf" || value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function evidenceError(code: string, message: string): Error & {readonly code: string} {
  return Object.assign(new Error(message), {code});
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MANAGER_ID_PATTERN = /^[a-z0-9._-]{1,128}$/iu;
const GENERATION_PATTERN = /^[1-9][0-9]{0,30}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SUBMISSION_REVISION_PATTERN = /^ts:[0-9]{1,12}:[0-9]{9}$/u;
