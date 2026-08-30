import assert from "node:assert/strict";
import test from "node:test";

import {resolveCanonicalManagerDocumentReference} from "./manager-document-contract.ts";

const MANAGER_ID = "manager-1";

function canonicalData(documentKey: "license" | "nursingLicense") {
  const storagePath = `manager-documents/${MANAGER_ID}/${documentKey}/certificate.png`;
  return {
    managerDocumentFiles: {[documentKey]: {fullPath: storagePath}},
    managerDocumentFilePaths: {[documentKey]: storagePath},
    ...(documentKey === "license" ? {managerLicenseStoragePath: storagePath} : {}),
  };
}

test("canonical resolver는 현재 자격 증빙 한 종류의 일치하는 포인터만 허용한다", () => {
  assert.deepEqual(resolveCanonicalManagerDocumentReference(canonicalData("license"), MANAGER_ID), {
    documentKey: "license",
    storagePath: `manager-documents/${MANAGER_ID}/license/certificate.png`,
  });
  assert.deepEqual(resolveCanonicalManagerDocumentReference(canonicalData("nursingLicense"), MANAGER_ID), {
    documentKey: "nursingLicense",
    storagePath: `manager-documents/${MANAGER_ID}/nursingLicense/certificate.png`,
  });
});

test("canonical resolver는 두 자격 키 동시 존재와 포인터 또는 별칭 불일치를 거부한다", () => {
  assert.equal(resolveCanonicalManagerDocumentReference({
    ...canonicalData("license"),
    managerDocumentFiles: {
      ...canonicalData("license").managerDocumentFiles,
      ...canonicalData("nursingLicense").managerDocumentFiles,
    },
    managerDocumentFilePaths: {
      ...canonicalData("license").managerDocumentFilePaths,
      ...canonicalData("nursingLicense").managerDocumentFilePaths,
    },
  }, MANAGER_ID), null);
  assert.equal(resolveCanonicalManagerDocumentReference({
    ...canonicalData("license"),
    managerLicenseStoragePath: `manager-documents/${MANAGER_ID}/license/other.png`,
  }, MANAGER_ID), null);
  assert.equal(resolveCanonicalManagerDocumentReference({
    ...canonicalData("nursingLicense"),
    managerDocumentFilePaths: {
      nursingLicense: `manager-documents/${MANAGER_ID}/nursingLicense/other.png`,
    },
  }, MANAGER_ID), null);
});

test("canonical resolver는 마이그레이션·보존 전용 키와 비정규 경로를 심사 대상으로 보지 않는다", () => {
  for (const legacyKey of ["healthCertificate", "idCard", "criminalRecord"]) {
    const storagePath = `manager-documents/${MANAGER_ID}/${legacyKey}/source.png`;
    assert.equal(resolveCanonicalManagerDocumentReference({
      managerDocumentFiles: {[legacyKey]: {fullPath: storagePath}},
      managerDocumentFilePaths: {[legacyKey]: storagePath},
    }, MANAGER_ID), null);
  }
  assert.equal(resolveCanonicalManagerDocumentReference({
    ...canonicalData("nursingLicense"),
    managerDocumentFilePaths: {nursingLicense: `manager-documents/${MANAGER_ID}/license/source.png`},
  }, MANAGER_ID), null);
});
