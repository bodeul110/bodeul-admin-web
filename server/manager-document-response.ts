export type InlineManagerDocumentContentType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

const INLINE_MANAGER_DOCUMENT_CONTENT_TYPES = new Set<InlineManagerDocumentContentType>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function normalizeInlineManagerDocumentContentType(
  value: string,
): InlineManagerDocumentContentType | null {
  const normalized = value.trim().toLowerCase();
  return INLINE_MANAGER_DOCUMENT_CONTENT_TYPES.has(normalized as InlineManagerDocumentContentType)
    ? normalized as InlineManagerDocumentContentType
    : null;
}

export function managerDocumentResponseHeaders(
  contentType: "application/pdf" | "image/webp",
  updatedAt: string,
  evidenceToken: string,
): Record<string, string> {
  const fileName = contentType === "application/pdf"
    ? "manager-document-preview.pdf"
    : "manager-document-preview.webp";
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Admin-Document-Name": encodeURIComponent(fileName),
    "X-Admin-Document-Updated-At": updatedAt,
    "X-Admin-Document-Evidence": evidenceToken,
  };
}
