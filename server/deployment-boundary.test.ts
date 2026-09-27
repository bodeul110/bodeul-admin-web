import assert from "node:assert/strict";
import test from "node:test";
import {assertAdminDatabaseBoundary, assertDeploymentBoundary} from "./deployment-boundary.ts";

function environment(production = false): Record<string, string> {
  const project = production ? "bodeul-prod-110" : "bodeul-dev";
  const number = production ? "649312328770" : "533563500316";
  const ref = production ? "aoijbzgozbopsxzrasbb" : "parpdzttloacinyvhwmx";
  return {
    VERCEL: "1", VERCEL_ENV: production ? "production" : "preview",
    FIREBASE_PROJECT_ID: project,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: number,
    NEXT_PUBLIC_FIREBASE_APP_ID: `1:${number}:web:test`,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${project}.firebasestorage.app`,
    ADMIN_DATABASE_URL: `postgresql://bodeul_admin_service.${ref}:test-password@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`,
  };
}

test("환경별 Firebase와 전용 관리자 DB role을 허용한다", () => {
  for (const production of [false, true]) {
    const env = environment(production);
    assert.doesNotThrow(() => assertDeploymentBoundary(env));
    const ref = production ? "aoijbzgozbopsxzrasbb" : "parpdzttloacinyvhwmx";
    env.ADMIN_DATABASE_URL = `postgresql://bodeul_admin_service:test@db.${ref}.supabase.co:5432/postgres`;
    assert.doesNotThrow(() => assertDeploymentBoundary(env));
  }
});

test("기존 VITE 공개 설정 fallback도 같은 경계를 검증한다", () => {
  const env = environment();
  for (const key of Object.keys(env).filter((name) => name.startsWith("NEXT_PUBLIC_"))) {
    env[key.replace("NEXT_PUBLIC_", "VITE_")] = env[key];
    delete env[key];
  }
  assert.doesNotThrow(() => assertDeploymentBoundary(env));
  env.VITE_FIREBASE_PROJECT_ID = "bodeul-prod-110";
  assert.throws(() => assertDeploymentBoundary(env), /Firebase/u);
});

test("개발·운영 Firebase와 DB가 섞이면 거부한다", () => {
  for (const production of [false, true]) {
    const env = environment(production);
    const other = environment(!production);
    for (const key of ["FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "NEXT_PUBLIC_FIREBASE_APP_ID",
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "ADMIN_DATABASE_URL"]) {
      assert.throws(() => assertDeploymentBoundary({...env, [key]: other[key]}), Error, key);
    }
    assert.throws(() => assertDeploymentBoundary({...env, FIREBASE_STORAGE_BUCKET: "wrong.appspot.com"}));
  }
});

test("Vercel DB 누락, 타 프로젝트, 관리용·Core role, 로컬 주소와 타 리전은 거부한다", () => {
  const env = environment();
  for (const value of ["", "not-a-url", "postgres://user:pass@localhost:5432/postgres",
    env.ADMIN_DATABASE_URL.replace("bodeul_admin_service", "postgres"),
    env.ADMIN_DATABASE_URL.replace("bodeul_admin_service", "bodeul_core_service"),
    env.ADMIN_DATABASE_URL.replace("ap-northeast-1", "us-east-1"),
    env.ADMIN_DATABASE_URL.replace("parpdzttloacinyvhwmx", "anotherprojectrefhere"),
    env.ADMIN_DATABASE_URL.replace("5432", "1234"),
    env.ADMIN_DATABASE_URL.replace("/postgres", "/other"),
    env.ADMIN_DATABASE_URL.replace("postgresql:", "https:"),
    env.ADMIN_DATABASE_URL.replace("test-password", "")]) {
    assert.throws(() => assertAdminDatabaseBoundary(value, env));
  }
});

test("오류에 연결 문자열과 비밀번호를 노출하지 않는다", () => {
  assert.throws(() => assertAdminDatabaseBoundary("invalid:secret-password", environment()), (error: Error) => {
    assert.doesNotMatch(error.message, /invalid:|secret-password/u);
    return true;
  });
});

test("DB URL 옵션으로 연결 대상·계정·TLS 설정을 덮어쓸 수 없다", () => {
  const env = environment();
  for (const suffix of ["?host=localhost", "?user=postgres", "?port=1234",
    "?sslmode=disable", "?ssl=0", "#other-database"]) {
    assert.throws(() => assertAdminDatabaseBoundary(env.ADMIN_DATABASE_URL + suffix, env));
  }
});

test("설정 일부 누락과 미지원 Vercel 환경은 fail-closed로 처리한다", () => {
  const env = environment();
  for (const key of Object.keys(env).filter((name) => !name.startsWith("VERCEL"))) {
    assert.throws(() => assertDeploymentBoundary({...env, [key]: ""}));
  }
  assert.throws(() => assertDeploymentBoundary({...env, VERCEL_ENV: "staging"}));
});

test("Vercel이 아닌 로컬·CI placeholder에는 실제 프로젝트 설정을 요구하지 않는다", () => {
  assert.doesNotThrow(() => assertDeploymentBoundary({VERCEL_ENV: "preview", FIREBASE_PROJECT_ID: "bodeul-ci"}));
  assert.doesNotThrow(() => assertAdminDatabaseBoundary("postgres://localhost/test", {}));
});
