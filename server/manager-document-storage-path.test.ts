import assert from "node:assert/strict";
import test from "node:test";

import {isAllowedManagerDocumentStoragePath} from "./manager-document-storage-path.ts";

test("매니저 증빙 경로는 대상 UID와 허용 문서 종류의 단일 파일만 허용한다", () => {
  assert.equal(isAllowedManagerDocumentStoragePath(
    "manager-1",
    "license",
    "manager-documents/manager-1/license/certificate.pdf",
  ), true);
  assert.equal(isAllowedManagerDocumentStoragePath(
    "manager-1",
    "nursingLicense",
    "manager-documents/manager-1/nursingLicense/certificate.pdf",
  ), true);
  assert.equal(isAllowedManagerDocumentStoragePath(
    "manager-1",
    "license",
    "manager-documents/manager-1/healthCertificate/certificate.pdf",
  ), false);
  assert.equal(isAllowedManagerDocumentStoragePath(
    "manager-1",
    "license",
    "manager-documents/manager-2/license/certificate.pdf",
  ), false);
  assert.equal(isAllowedManagerDocumentStoragePath(
    "manager-1",
    "license",
    "other/private/object.pdf",
  ), false);
  assert.equal(isAllowedManagerDocumentStoragePath(
    "manager-1",
    "license",
    "manager-documents/manager-1/license/nested/certificate.pdf",
  ), false);
});
