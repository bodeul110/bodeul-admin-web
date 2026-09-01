import type {ManagerDocumentKey} from "./admin-manager-reviews.ts";

const ACTIVE_MANAGER_DOCUMENT_KEYS: readonly ManagerDocumentKey[] = ["license", "nursingLicense"];

export type CanonicalManagerDocumentReference = {
  readonly documentKey: ManagerDocumentKey;
  readonly storagePath: string;
};

export function resolveCanonicalManagerDocumentReference(
  data: Record<string, unknown>,
  managerUserId: string,
): CanonicalManagerDocumentReference | null {
  const fileMap = isRecord(data.managerDocumentFiles) ? data.managerDocumentFiles : {};
  const pathMap = isRecord(data.managerDocumentFilePaths) ? data.managerDocumentFilePaths : {};
  const presentKeys = ACTIVE_MANAGER_DOCUMENT_KEYS.filter((documentKey) => (
    Object.hasOwn(fileMap, documentKey)
      || Object.hasOwn(pathMap, documentKey)
      || (documentKey === "license" && Object.hasOwn(data, "managerLicenseStoragePath"))
  ));
  if (presentKeys.length !== 1) return null;

  const documentKey = presentKeys[0]!;
  const metadata = isRecord(fileMap[documentKey]) ? fileMap[documentKey] : {};
  const requiredPaths = [metadata.fullPath, pathMap[documentKey]];
  if (documentKey === "license") {
    if (!Object.hasOwn(data, "managerLicenseStoragePath")) return null;
    requiredPaths.push(data.managerLicenseStoragePath);
  }
  if (requiredPaths.some((storagePath) => !isExactNonEmptyString(storagePath))
      || new Set(requiredPaths).size !== 1) {
    return null;
  }

  const storagePath = requiredPaths[0] as string;
  return isCanonicalStoragePath(managerUserId, documentKey, storagePath)
    ? {documentKey, storagePath}
    : null;
}

function isCanonicalStoragePath(
  managerUserId: string,
  documentKey: ManagerDocumentKey,
  storagePath: string,
): boolean {
  const segments = storagePath.split("/");
  return segments.length === 4
    && segments[0] === "manager-documents"
    && segments[1] === managerUserId
    && segments[2] === documentKey
    && isExactNonEmptyString(segments[3]);
}

function isExactNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
