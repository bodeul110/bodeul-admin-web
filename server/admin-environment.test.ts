import assert from "node:assert/strict";
import test from "node:test";
import {resolveAdminEnvironment} from "../src/adminEnvironment.ts";

test("운영 배포 정보가 있을 때만 운영 환경을 표시한다", () => {
  assert.deepEqual(resolveAdminEnvironment("production", false), {
    kind: "production", label: "운영 환경", detail: "운영 배포 · Production",
  });
  assert.equal(resolveAdminEnvironment(" production ", true).kind, "production");
});

test("최적화된 Preview 빌드도 개발 환경으로 표시한다", () => {
  assert.deepEqual(resolveAdminEnvironment("preview", false), {
    kind: "preview", label: "개발 환경", detail: "미리보기 배포 · Preview",
  });
  assert.equal(resolveAdminEnvironment("preview", true).kind, "preview");
});

test("로컬 개발 실행은 미리보기와 구분한다", () => {
  const expected = {kind: "local", label: "개발 환경", detail: "로컬 실행 · Local"};
  assert.deepEqual(resolveAdminEnvironment("development", false), expected);
  assert.deepEqual(resolveAdminEnvironment(undefined, true), expected);
  assert.deepEqual(resolveAdminEnvironment("", true), expected);
  assert.deepEqual(resolveAdminEnvironment("  ", true), expected);
});

test("배포 정보가 없는 최적화된 빌드나 미지원 환경을 임의로 운영 또는 개발로 표시하지 않는다", () => {
  const expected = {kind: "unknown", label: "환경 확인 필요", detail: "배포 환경을 확인해 주세요"};
  for (const value of [undefined, "", "  ", "staging", "Production"]) {
    assert.deepEqual(resolveAdminEnvironment(value, false), expected);
  }
  assert.deepEqual(resolveAdminEnvironment("staging", true), expected);
});
