import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminAccessContext,
  type AdminAccessContextPayload,
} from "./admin-access-context.ts";
import type {AdminAuthorizationDependencies, AdminDetailRole} from "./admin-auth.ts";

function dependencies(
  adminRole: AdminDetailRole | null,
  breakGlassExpiresAt: string | null = null,
): AdminAuthorizationDependencies {
  return {
    mode: "off",
    allowedAppIds: new Set(),
    async verifyAppCheckToken() {
      throw new Error("off 모드에서는 호출되지 않아야 합니다.");
    },
    recordVerdict() {},
    async verifyIdToken() {
      return {uid: "admin-uid"};
    },
    async findAppUserByFirebaseUid() {
      return {
        id: "5f0dcf7a-a842-4b79-985d-f94cf880db4a",
        role: "ADMIN",
        adminRole,
        breakGlassExpiresAt,
      };
    },
  };
}

test("OPERATIONS는 운영·심사·원문 미리보기 권한만 받는다", async () => {
  const result = await handleAdminAccessContext(
    "Bearer firebase-token",
    null,
    dependencies("OPERATIONS"),
  );

  assert.equal(result.status, 200);
  const payload = result.body as AdminAccessContextPayload;
  assert.equal(payload.role, "OPERATIONS");
  assert.deepEqual(payload.permissions, ["OPERATIONS_READ", "MANAGER_REVIEW", "RAW_PREVIEW"]);
});

test("DEVELOPER는 production 운영·민감정보 권한을 받지 않는다", async () => {
  const result = await handleAdminAccessContext(
    "Bearer firebase-token",
    null,
    dependencies("DEVELOPER"),
  );

  const payload = result.body as AdminAccessContextPayload;
  assert.deepEqual(payload.permissions, ["DEVELOPER_DIAGNOSTICS"]);
});

test("SUPER_ADMIN 다운로드 권한은 유효한 break-glass 동안만 노출한다", async () => {
  const withoutGrant = await handleAdminAccessContext(
    "Bearer firebase-token",
    null,
    dependencies("SUPER_ADMIN"),
  );
  const withGrant = await handleAdminAccessContext(
    "Bearer firebase-token",
    null,
    dependencies("SUPER_ADMIN", new Date(Date.now() + 60_000).toISOString()),
  );

  assert.equal((withoutGrant.body as AdminAccessContextPayload).permissions.includes("RAW_DOWNLOAD"), false);
  assert.equal((withGrant.body as AdminAccessContextPayload).permissions.includes("RAW_DOWNLOAD"), true);
});

test("세부 역할이 없으면 ADMIN이어도 fail-closed로 거부한다", async () => {
  const result = await handleAdminAccessContext(
    "Bearer firebase-token",
    null,
    dependencies(null),
  );

  assert.equal(result.status, 403);
  assert.equal("error" in result.body ? result.body.error : "", "admin_detail_role_required");
});

test("MFA enforce 모드는 2차 인증 없는 token을 DB 조회 전에 거부한다", async () => {
  let databaseCalled = false;
  const result = await handleAdminAccessContext(
    "Bearer firebase-token",
    null,
    {
      ...dependencies("SUPER_ADMIN"),
      mfaMode: "enforce",
      async verifyIdToken() { return {uid: "admin-uid", mfaVerified: false}; },
      async findAppUserByFirebaseUid() {
        databaseCalled = true;
        return null;
      },
    },
  );

  assert.equal(result.status, 401);
  assert.equal("error" in result.body ? result.body.error : "", "admin_mfa_required");
  assert.equal(databaseCalled, false);
});
