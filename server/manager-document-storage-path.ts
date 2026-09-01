import type {ManagerDocumentKey} from "./admin-manager-reviews.ts";

const DOCUMENT_STORAGE_KEYS: Record<ManagerDocumentKey, readonly string[]> = {
  license: ["license"],
  nursingLicense: ["nursingLicense"],
};

export function documentStorageKeys(documentKey: ManagerDocumentKey): readonly string[] {
  return DOCUMENT_STORAGE_KEYS[documentKey];
}

export function isAllowedManagerDocumentStoragePath(
  managerUserId: string,
  documentKey: ManagerDocumentKey,
  storagePath: string,
): boolean {
  const segments = storagePath.split("/");
  return segments.length === 4
    && segments[0] === "manager-documents"
    && segments[1] === managerUserId
    && DOCUMENT_STORAGE_KEYS[documentKey].includes(segments[2])
    && Boolean(segments[3]);
}
