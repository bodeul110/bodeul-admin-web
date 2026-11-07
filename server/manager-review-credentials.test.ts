import assert from "node:assert/strict";
import test from "node:test";
import {assertManagerReviewCredentials, ManagerReviewCredentialsError} from "./manager-review-credentials.ts";

test("Vercel의 Firestore 서버 자격 증명이 없으면 ADC 검색 전에 중단한다", () => {
  for (const value of [undefined, "", "  "]) {
    assert.throws(() => assertManagerReviewCredentials({
      VERCEL: "1", FIREBASE_SERVICE_ACCOUNT_JSON: value,
    }), ManagerReviewCredentialsError);
  }
});

test("기존 서버 자격 증명의 형식 검증은 Firebase Admin 초기화에서 유지한다", () => {
  assert.doesNotThrow(() => assertManagerReviewCredentials({
    VERCEL: "1", FIREBASE_SERVICE_ACCOUNT_JSON: "server-only-credential",
  }));
});

test("로컬 ADC와 에뮬레이터 경로는 변경하지 않는다", () => {
  assert.doesNotThrow(() => assertManagerReviewCredentials({}));
});
