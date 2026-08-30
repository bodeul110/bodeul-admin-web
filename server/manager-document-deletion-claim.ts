export const MANAGER_DOCUMENT_DELETION_CLAIM_FIELD = "managerDocumentDeletionClaim";

export function managerDocumentDeletionClaimBlocksAdminWrite(data: unknown): boolean {
  return isRecord(data)
    && Object.prototype.hasOwnProperty.call(data, MANAGER_DOCUMENT_DELETION_CLAIM_FIELD);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
