import assert from "node:assert/strict";
import test from "node:test";
import type { User as FirebaseUser } from "firebase/auth";

import { adminSessionErrorMessage, resolveAdminSession } from "../src/adminSession.ts";
import type { AdminAccessContextPayload } from "../src/bodeulApi.ts";

const context: AdminAccessContextPayload = {
  adminUserId: "admin-test-id",
  role: "OPERATIONS",
  permissions: ["OPERATIONS_READ", "MANAGER_REVIEW", "RAW_PREVIEW"],
  breakGlassExpiresAt: null,
};

function user(displayName: string | null = null): FirebaseUser {
  return {uid: "firebase-admin-test", displayName} as FirebaseUser;
}

test("Firestore 사용자 문서 없이 서버가 허용한 관리자 세션을 연다", async () => {
  const identity = user("  운영 담당자  ");
  let calls = 0;
  const result = await resolveAdminSession(identity, async (received) => {
    assert.equal(received, identity);
    calls += 1;
    return context;
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    adminName: "운영 담당자",
    adminRole: "OPERATIONS",
    permissions: context.permissions,
    breakGlassExpiresAt: null,
  });
  assert.equal(result.permissions.includes("RAW_DOWNLOAD"), false);
});

test("표시 이름이 없어도 서버 인가를 확인하며 개인정보 대신 기본 이름을 쓴다", async () => {
  for (const displayName of [null, "", "   "]) {
    const result = await resolveAdminSession(user(displayName), async () => ({
      ...context,
      role: "DEVELOPER",
      permissions: ["DEVELOPER_DIAGNOSTICS"],
    }));
    assert.equal(result.adminName, "관리자");
    assert.equal(result.adminRole, "DEVELOPER");
    assert.deepEqual(result.permissions, ["DEVELOPER_DIAGNOSTICS"]);
  }
});

test("서버 인가가 끝나기 전에는 관리자 세션을 반환하지 않는다", async () => {
  let resolveContext: (value: AdminAccessContextPayload) => void = () => {};
  const pending = new Promise<AdminAccessContextPayload>((resolve) => { resolveContext = resolve; });
  let completed = false;
  const session = resolveAdminSession(user(), () => pending).then((result) => {
    completed = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  resolveContext(context);
  await session;
  assert.equal(completed, true);
});

for (const code of [
  "admin_role_required",
  "admin_detail_role_required",
  "admin_mfa_required",
  "app_check_required",
  "invalid_firebase_token",
  "role_lookup_failed",
  "network_error",
]) {
  test(`${code} 실패를 관리자 세션으로 바꾸지 않는다`, async () => {
    const failure = Object.assign(new Error("서버 요청 거부"), {code});
    await assert.rejects(
      resolveAdminSession(user("관리자"), async () => { throw failure; }),
      (error) => error === failure,
    );
  });
}

test("권한 미등록, 업무 역할 미등록, MFA와 서버 장애 안내를 구분한다", () => {
  assert.match(adminSessionErrorMessage("admin_role_required"), /관리자 권한이 등록되어 있지/);
  assert.match(adminSessionErrorMessage("admin_detail_role_required"), /활성 관리자 업무 역할이 없/);
  assert.match(adminSessionErrorMessage("admin_mfa_required"), /관리자 2차 인증/);
  assert.match(adminSessionErrorMessage("role_lookup_failed"), /잠시 후 다시 시도/);
  assert.equal(adminSessionErrorMessage("unknown"), "관리자 세션을 확인하지 못했습니다.");
  assert.equal(adminSessionErrorMessage(), "관리자 세션을 확인하지 못했습니다.");
});
