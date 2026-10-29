import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import test from "node:test";
import {cert, deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {
  requireManagerListReaderCredential,
  resolveManagerListAuthMode,
  type ManagerListEnvironment,
} from "./manager-list-reader-policy.ts";

const SYNTHETIC_KEY = "-----BEGIN PRIVATE KEY-----\nsynthetic-not-a-real-key\n-----END PRIVATE KEY-----";
const syntheticCredential = {
  type: "service_account",
  project_id: "bodeul-dev",
  client_email: "admin-manager-list-dev@bodeul-dev.iam.gserviceaccount.com",
  private_key: SYNTHETIC_KEY,
};
const syntheticEnv: ManagerListEnvironment = {
  MANAGER_LIST_AUTH_MODE: "json-reader",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "dev",
  FIREBASE_PROJECT_ID: "bodeul-dev",
  FIREBASE_MANAGER_LIST_SERVICE_ACCOUNT_JSON: JSON.stringify(syntheticCredential),
};

test("목록 인증은 기본 legacy이며 명시하지 않은 모드는 거부한다", () => {
  assert.equal(resolveManagerListAuthMode({}), "legacy");
  assert.equal(resolveManagerListAuthMode({MANAGER_LIST_AUTH_MODE: " legacy "}), "legacy");
  assert.equal(resolveManagerListAuthMode(syntheticEnv), "json-reader");
  assert.throws(() => resolveManagerListAuthMode({MANAGER_LIST_AUTH_MODE: "reader-typo"}));
});

test("전용 JSON reader는 정확한 DEV Preview와 dev 브랜치·프로젝트에서만 허용한다", () => {
  for (const changes of [
    {MANAGER_LIST_AUTH_MODE: "legacy"}, {VERCEL: undefined}, {VERCEL: "0"},
    {VERCEL_ENV: "production"}, {VERCEL_ENV: "development"},
    {VERCEL_GIT_COMMIT_REF: undefined}, {VERCEL_GIT_COMMIT_REF: "feature/example"},
    {FIREBASE_PROJECT_ID: undefined}, {FIREBASE_PROJECT_ID: "bodeul-prod-110"},
  ]) {
    assert.throws(() => requireManagerListReaderCredential({...syntheticEnv, ...changes}));
  }
  const credential = requireManagerListReaderCredential(syntheticEnv);
  assert.equal(credential.projectId, "bodeul-dev");
  assert.equal(credential.clientEmail, syntheticCredential.client_email);
});

test("누락·깨진 JSON·다른 프로젝트/계정·키 형식은 비밀 없는 오류로 거부한다", () => {
  const sentinel = "synthetic-secret-must-not-appear";
  const invalidJsonValues: (string | undefined)[] = [
    undefined, "", `${sentinel}{`, "null", "[]", JSON.stringify(sentinel),
    JSON.stringify({...syntheticCredential, type: "authorized_user"}),
    JSON.stringify({...syntheticCredential, project_id: "bodeul-prod-110"}),
    JSON.stringify({...syntheticCredential, client_email: "another@bodeul-dev.iam.gserviceaccount.com"}),
    JSON.stringify({...syntheticCredential, private_key: sentinel}),
    JSON.stringify({...syntheticCredential, private_key: null}),
  ];
  for (const value of invalidJsonValues) {
    assert.throws(() => requireManagerListReaderCredential({
      ...syntheticEnv, FIREBASE_MANAGER_LIST_SERVICE_ACCOUNT_JSON: value,
    }), (error: unknown) => error instanceof Error
      && !error.message.includes(sentinel) && error.cause === undefined);
  }
});

test("JSON의 줄바꿈과 기존 이스케이프 줄바꿈을 native cert 입력으로 정규화한다", () => {
  const credential = requireManagerListReaderCredential({
    ...syntheticEnv,
    FIREBASE_MANAGER_LIST_SERVICE_ACCOUNT_JSON: JSON.stringify({
      ...syntheticCredential, private_key: SYNTHETIC_KEY.replace(/\n/gu, "\\n"),
    }),
  });
  assert.equal(credential.privateKey, SYNTHETIC_KEY);
});

test("현재 SDK의 native cert는 별도 App의 기본 DB client를 외부 요청 없이 구성한다", async () => {
  // Google 서비스 계정 키를 생성하지 않는다. 로컬 메모리 RSA fixture만 사용한다.
  const {privateKey} = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {type: "pkcs8", format: "pem"},
    publicKeyEncoding: {type: "spki", format: "pem"},
  });
  const credential = requireManagerListReaderCredential({
    ...syntheticEnv,
    FIREBASE_MANAGER_LIST_SERVICE_ACCOUNT_JSON: JSON.stringify({...syntheticCredential, private_key: privateKey}),
  });
  const legacy = initializeApp({projectId: "synthetic-legacy"}, "synthetic-list-legacy");
  const reader = initializeApp({projectId: credential.projectId, credential: cert(credential)}, "synthetic-json-reader");
  const firestore = getFirestore(reader);
  try {
    assert.equal(reader.options.projectId, "bodeul-dev");
    assert.equal(firestore, getFirestore(reader));
    assert.equal(firestore.doc("users/synthetic-manager").path, "users/synthetic-manager");
    assert.equal(legacy.options.projectId, "synthetic-legacy");
    assert.notEqual(reader, legacy);
    // getAccessToken·문서 조회·Storage·write는 호출하지 않는다.
  } finally {
    await firestore.terminate();
    await deleteApp(reader);
    await deleteApp(legacy);
  }
});
