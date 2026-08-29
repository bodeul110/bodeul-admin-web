import assert from "node:assert/strict";
import test from "node:test";

import {
  managerDocumentResponseHeaders,
  normalizeInlineManagerDocumentContentType,
} from "./manager-document-response.ts";

test("관리자 문서 인라인 응답은 PDF와 안전한 래스터 이미지만 허용한다", () => {
  assert.equal(normalizeInlineManagerDocumentContentType("application/pdf"), "application/pdf");
  assert.equal(normalizeInlineManagerDocumentContentType(" IMAGE/JPEG "), "image/jpeg");
  assert.equal(normalizeInlineManagerDocumentContentType("image/png"), "image/png");
  assert.equal(normalizeInlineManagerDocumentContentType("image/webp"), "image/webp");
  assert.equal(normalizeInlineManagerDocumentContentType("text/html"), null);
  assert.equal(normalizeInlineManagerDocumentContentType("image/svg+xml"), null);
  assert.equal(normalizeInlineManagerDocumentContentType("image/gif"), null);
});

test("관리자 문서 응답은 스크립트 실행과 캐시를 차단하는 헤더를 고정한다", () => {
  const headers = managerDocumentResponseHeaders(
    "image/png",
    "신분증 원본.png",
    "2026-08-29T00:00:00.000Z",
  );

  assert.equal(headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(headers["Content-Security-Policy"], "sandbox; default-src 'none'");
  assert.equal(headers["Content-Type"], "image/png");
  assert.equal(headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Content-Disposition"], /^inline; filename\*=UTF-8''/u);
});
