import assert from "node:assert/strict";
import test from "node:test";

import {
  createManagerDocumentEvidenceToken,
  managerDocumentEvidenceSetDigest,
  managerDocumentStoragePathDigest,
  verifyManagerDocumentEvidenceSet,
  verifyManagerDocumentEvidenceToken,
} from "./manager-document-evidence.ts";

const HMAC_KEY = "test-manager-review-outbox-key-0001";
const ACTOR_ID = "5f0dcf7a-a842-4b79-985d-f94cf880db4a";
const MANAGER_ID = "manager-user";
const NOW = Date.parse("2026-08-29T00:00:00.000Z");

function createToken(documentKey: "idCard" | "license" | "criminalRecord") {
  const storagePath = `manager-documents/${MANAGER_ID}/${documentKey}/source.pdf`;
  return createManagerDocumentEvidenceToken({
    actorAdminUserId: ACTOR_ID,
    managerUserId: MANAGER_ID,
    documentKey,
    storagePathDigest: managerDocumentStoragePathDigest(storagePath, HMAC_KEY),
    generation: "123456789",
    digest: documentKey === "idCard" ? "1".repeat(64)
      : documentKey === "license" ? "2".repeat(64) : "3".repeat(64),
    contentType: "application/pdf",
  }, HMAC_KEY, NOW);
}

test("문서 확인 증거는 Storage 경로를 노출하지 않고 서명 범위만 복원한다", () => {
  const storagePath = `manager-documents/${MANAGER_ID}/idCard/source.pdf`;
  const {token, evidence} = createToken("idCard");
  const payload = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8")) as Record<string, unknown>;

  assert.equal("storagePath" in payload, false);
  assert.equal(JSON.stringify(payload).includes(storagePath), false);
  assert.equal(payload.storagePathDigest, managerDocumentStoragePathDigest(storagePath, HMAC_KEY));
  assert.notEqual(payload.storagePathDigest, managerDocumentStoragePathDigest(storagePath, `${HMAC_KEY}-other`));
  assert.deepEqual(
    verifyManagerDocumentEvidenceToken(token, HMAC_KEY, {actorAdminUserId: ACTOR_ID, managerUserId: MANAGER_ID}, NOW),
    evidence,
  );
});

test("위조, 다른 actor와 만료된 문서 확인 증거를 거부한다", () => {
  const {token} = createToken("idCard");
  const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;

  assert.throws(() => verifyManagerDocumentEvidenceToken(
    tampered, HMAC_KEY, {actorAdminUserId: ACTOR_ID, managerUserId: MANAGER_ID}, NOW,
  ));
  assert.throws(() => verifyManagerDocumentEvidenceToken(
    token,
    HMAC_KEY,
    {actorAdminUserId: "8d8fbac5-8eb1-5bb0-b584-b17919cacb7d", managerUserId: MANAGER_ID},
    NOW,
  ));
  assert.throws(() => verifyManagerDocumentEvidenceToken(
    token, HMAC_KEY, {actorAdminUserId: ACTOR_ID, managerUserId: MANAGER_ID}, NOW + 10 * 60 * 1000,
  ));
});

test("승인 증거는 세 문서가 중복 없이 모두 있어야 하며 집합 digest가 버전을 고정한다", () => {
  const items = [createToken("idCard"), createToken("license"), createToken("criminalRecord")];
  const tokens = items.map((item) => item.token);
  const evidence = verifyManagerDocumentEvidenceSet(
    tokens, HMAC_KEY, {actorAdminUserId: ACTOR_ID, managerUserId: MANAGER_ID}, NOW,
  );

  assert.match(managerDocumentEvidenceSetDigest(evidence), /^[0-9a-f]{64}$/u);
  assert.throws(() => verifyManagerDocumentEvidenceSet(
    [tokens[0]!, tokens[0]!, tokens[2]!],
    HMAC_KEY,
    {actorAdminUserId: ACTOR_ID, managerUserId: MANAGER_ID},
    NOW,
  ));
});
