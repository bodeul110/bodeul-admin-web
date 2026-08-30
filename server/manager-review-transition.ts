import type {ManagerDocumentKey} from "./admin-manager-reviews.ts";
import type {ManagerDocumentEvidence} from "./manager-document-evidence.ts";

export type ManagerDocumentApprovalEvidenceSnapshot = {
  readonly actorAdminUserId: string;
  readonly managerUserId: string;
  readonly documentKey: ManagerDocumentKey;
  readonly storagePathDigest: string;
  readonly generation: string;
  readonly digest: string;
  readonly contentType: ManagerDocumentEvidence["contentType"];
  readonly submissionRevision: string;
};

export function validateManagerReviewTransition(input: {
  readonly currentStatus: unknown;
  readonly currentSubmissionRevision: string;
  readonly expectedSubmissionRevision: string;
  readonly decision: "APPROVED" | "REJECTED";
  readonly actorAdminUserId: string;
  readonly managerUserId: string;
  readonly documentEvidence: readonly ManagerDocumentEvidence[];
  readonly currentStoragePathDigests: Readonly<Partial<Record<ManagerDocumentKey, string>>>;
}): readonly ManagerDocumentApprovalEvidenceSnapshot[] {
  if (input.currentStatus !== "PENDING_REVIEW") {
    throw transitionError("manager_review_not_pending", "이미 처리됐거나 심사 대기 상태가 아닌 제출입니다.");
  }
  if (!input.currentSubmissionRevision
      || input.currentSubmissionRevision !== input.expectedSubmissionRevision) {
    throw transitionError("manager_document_revision_stale", "확인한 뒤 제출 revision이 변경되었습니다.");
  }
  if (input.decision === "REJECTED") {
    if (input.documentEvidence.length !== 0) {
      throw transitionError("manager_document_evidence_invalid", "반려 요청에는 승인 증거를 포함할 수 없습니다.");
    }
    return [];
  }

  const currentDocuments = (Object.entries(input.currentStoragePathDigests) as [ManagerDocumentKey, string][])
    .filter(([, digest]) => Boolean(digest));
  if (currentDocuments.length !== 1 || input.documentEvidence.length !== 1) {
    throw transitionError(
      "manager_document_evidence_stale",
      "현재 자격 증빙 하나와 문서 확인 증거 하나가 일치해야 합니다.",
    );
  }
  const [currentDocumentKey, currentStoragePathDigest] = currentDocuments[0]!;

  const snapshots = input.documentEvidence.map((evidence) => {
    if (evidence.actorAdminUserId !== input.actorAdminUserId
        || evidence.managerUserId !== input.managerUserId
        || evidence.submissionRevision !== input.expectedSubmissionRevision
        || evidence.documentKey !== currentDocumentKey
        || evidence.storagePathDigest !== currentStoragePathDigest) {
      throw transitionError("manager_document_evidence_stale", "현재 제출 문서가 확인한 문서와 다릅니다.");
    }
    return {
      actorAdminUserId: evidence.actorAdminUserId,
      managerUserId: evidence.managerUserId,
      documentKey: evidence.documentKey,
      storagePathDigest: evidence.storagePathDigest,
      generation: evidence.generation,
      digest: evidence.digest,
      contentType: evidence.contentType,
      submissionRevision: evidence.submissionRevision,
    };
  });
  return snapshots.sort((left, right) => left.documentKey.localeCompare(right.documentKey));
}

function transitionError(code: string, message: string): Error & {readonly code: string} {
  return Object.assign(new Error(message), {code});
}
