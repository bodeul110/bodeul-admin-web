import assert from "node:assert/strict";
import test from "node:test";

import {
  handleListAdminRoleAssignments,
  handleRevokeAdminRoleAssignment,
  handleSetAdminRoleAssignment,
  type AdminRoleManagementDependencies,
} from "./admin-role-management.ts";

const ACTOR_ID = "5f0dcf7a-a842-4b79-985d-f94cf880db4a";
const TARGET_ID = "cd5dc083-327c-4a3d-ae65-38c4683f25eb";

const dependencies: AdminRoleManagementDependencies = {
  mode: "off",
  allowedAppIds: new Set(),
  async verifyAppCheckToken() { throw new Error("호출되지 않아야 합니다."); },
  recordVerdict() {},
  async verifyIdToken() { return {uid: "admin-uid"}; },
  async findAppUserByFirebaseUid() {
    return {id: ACTOR_ID, role: "ADMIN", adminRole: "SUPER_ADMIN", breakGlassExpiresAt: null};
  },
  async listAdminRoleAssignments(actorId) {
    assert.equal(actorId, ACTOR_ID);
    return [{
      adminUserId: TARGET_ID,
      adminRole: "OPERATIONS",
      grantedAt: "2026-08-29T00:00:00.000Z",
      revokedAt: null,
      breakGlassGrantId: null,
      breakGlassExpiresAt: null,
    }];
  },
  async setAdminRoleAssignment(targetId, role, actorId, reason) {
    assert.deepEqual([targetId, role, actorId, reason], [
      TARGET_ID, "DEVELOPER", ACTOR_ID, "개발 진단 업무로 역할을 변경합니다.",
    ]);
  },
  async revokeAdminRoleAssignment(targetId, actorId, reason) {
    assert.deepEqual([targetId, actorId, reason], [
      TARGET_ID, ACTOR_ID, "프로젝트 참여 종료로 권한을 회수합니다.",
    ]);
  },
  async recordAdminAccessAudit() { return ACTOR_ID; },
};

test("SUPER_ADMIN은 역할 목록을 조회한다", async () => {
  const result = await handleListAdminRoleAssignments("Bearer token", null, dependencies);
  assert.equal(result.status, 200);
  assert.equal("items" in result.body ? result.body.items.length : 0, 1);
});

test("SUPER_ADMIN은 사유와 함께 역할을 변경하고 회수한다", async () => {
  const changed = await handleSetAdminRoleAssignment("Bearer token", null, {
    targetAdminUserId: TARGET_ID,
    adminRole: "DEVELOPER",
    reason: "개발 진단 업무로 역할을 변경합니다.",
  }, dependencies);
  const revoked = await handleRevokeAdminRoleAssignment("Bearer token", null, {
    targetAdminUserId: TARGET_ID,
    reason: "프로젝트 참여 종료로 권한을 회수합니다.",
  }, dependencies);
  assert.equal(changed.status, 200);
  assert.equal(revoked.status, 200);
});

test("OPERATIONS는 역할 관리 API를 사용할 수 없다", async () => {
  const result = await handleListAdminRoleAssignments("Bearer token", null, {
    ...dependencies,
    async findAppUserByFirebaseUid() {
      return {id: ACTOR_ID, role: "ADMIN", adminRole: "OPERATIONS", breakGlassExpiresAt: null};
    },
  });
  assert.equal(result.status, 403);
  assert.equal("error" in result.body ? result.body.error : "", "admin_detail_role_forbidden");
});

test("잘못된 UUID와 짧은 사유는 DB 호출 전에 거부한다", async () => {
  let called = false;
  const outcomes: string[] = [];
  const result = await handleSetAdminRoleAssignment("Bearer token", null, {
    targetAdminUserId: "bad",
    adminRole: "OPERATIONS",
    reason: "짧음",
  }, {
    ...dependencies,
    async setAdminRoleAssignment() { called = true; },
    async recordAdminAccessAudit(command) { outcomes.push(command.outcome); return ACTOR_ID; },
  });
  assert.equal(result.status, 400);
  assert.equal(called, false);
  assert.deepEqual(outcomes, ["DENIED"]);
});

test("역할 변경 DB 실패는 FAILED로 감사하고 감사 실패 시 fail-closed한다", async () => {
  const outcomes: string[] = [];
  const request = {
    targetAdminUserId: TARGET_ID,
    adminRole: "DEVELOPER" as const,
    reason: "개발 진단 업무로 역할을 변경합니다.",
  };
  const failed = await handleSetAdminRoleAssignment("Bearer token", null, request, {
    ...dependencies,
    async setAdminRoleAssignment() { throw new Error("database down"); },
    async recordAdminAccessAudit(command) { outcomes.push(command.outcome); return ACTOR_ID; },
  });
  const auditFailed = await handleSetAdminRoleAssignment("Bearer token", null, request, {
    ...dependencies,
    async setAdminRoleAssignment() { throw Object.assign(new Error("conflict"), {code: "P0001"}); },
    async recordAdminAccessAudit() { throw new Error("audit down"); },
  });

  assert.equal(failed.status, 503);
  assert.deepEqual(outcomes, ["FAILED"]);
  assert.equal(auditFailed.status, 503);
  assert.equal("error" in auditFailed.body ? auditFailed.body.error : "", "admin_audit_failed");
});
