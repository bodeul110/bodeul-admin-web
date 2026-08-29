import assert from "node:assert/strict";
import test from "node:test";

import {
  handleGrantAdminBreakGlass,
  handleRevokeAdminBreakGlass,
  type AdminBreakGlassDependencies,
} from "./admin-break-glass.ts";

const ACTOR_ID = "5f0dcf7a-a842-4b79-985d-f94cf880db4a";
const TARGET_ID = "cd5dc083-327c-4a3d-ae65-38c4683f25eb";
const GRANT_ID = "8d8fbac5-8eb1-5bb0-b584-b17919cacb7d";

const dependencies: AdminBreakGlassDependencies = {
  mode: "off",
  allowedAppIds: new Set(),
  async verifyAppCheckToken() { throw new Error("호출되지 않아야 합니다."); },
  recordVerdict() {},
  async verifyIdToken() { return {uid: "admin-uid"}; },
  async findAppUserByFirebaseUid() {
    return {id: ACTOR_ID, role: "ADMIN", adminRole: "SUPER_ADMIN", breakGlassExpiresAt: null};
  },
  async grantAdminBreakGlass(targetId, actorId, reason, duration) {
    assert.deepEqual([targetId, actorId, reason, duration], [
      TARGET_ID, ACTOR_ID, "보안 사고 대응을 위한 긴급 원본 확인", 30,
    ]);
    return GRANT_ID;
  },
  async revokeAdminBreakGlass(grantId, actorId, reason) {
    assert.deepEqual([grantId, actorId, reason], [
      GRANT_ID, ACTOR_ID, "긴급 확인이 끝나 권한을 즉시 회수합니다.",
    ]);
    return true;
  },
  async recordAdminAccessAudit() { return ACTOR_ID; },
};

test("SUPER_ADMIN은 다른 최고 관리자에게 최대 60분 긴급 권한을 승인한다", async () => {
  const result = await handleGrantAdminBreakGlass("Bearer token", null, {
    targetAdminUserId: TARGET_ID,
    reason: "보안 사고 대응을 위한 긴급 원본 확인",
    durationMinutes: 30,
  }, dependencies);
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {grantId: GRANT_ID});
});

test("활성 긴급 권한을 사유와 함께 회수한다", async () => {
  const result = await handleRevokeAdminBreakGlass("Bearer token", null, {
    grantId: GRANT_ID,
    reason: "긴급 확인이 끝나 권한을 즉시 회수합니다.",
  }, dependencies);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {revoked: true});
});

test("OPERATIONS는 긴급 권한을 승인할 수 없다", async () => {
  const outcomes: string[] = [];
  const result = await handleGrantAdminBreakGlass("Bearer token", null, {
    targetAdminUserId: TARGET_ID,
    reason: "보안 사고 대응을 위한 긴급 원본 확인",
    durationMinutes: 30,
  }, {
    ...dependencies,
    async findAppUserByFirebaseUid() {
      return {id: ACTOR_ID, role: "ADMIN", adminRole: "OPERATIONS", breakGlassExpiresAt: null};
    },
    async recordAdminAccessAudit(command) { outcomes.push(command.outcome); return ACTOR_ID; },
  });
  assert.equal(result.status, 403);
  assert.deepEqual(outcomes, ["DENIED"]);
});

test("긴급 권한 DB 실패는 FAILED로 감사하고 감사 실패 시 fail-closed한다", async () => {
  const outcomes: string[] = [];
  const request = {
    targetAdminUserId: TARGET_ID,
    reason: "보안 사고 대응을 위한 긴급 원본 확인",
    durationMinutes: 30,
  };
  const failed = await handleGrantAdminBreakGlass("Bearer token", null, request, {
    ...dependencies,
    async grantAdminBreakGlass() { throw new Error("database down"); },
    async recordAdminAccessAudit(command) { outcomes.push(command.outcome); return ACTOR_ID; },
  });
  const auditFailed = await handleGrantAdminBreakGlass("Bearer token", null, request, {
    ...dependencies,
    async grantAdminBreakGlass() { throw Object.assign(new Error("denied"), {code: "42501"}); },
    async recordAdminAccessAudit() { throw new Error("audit down"); },
  });

  assert.equal(failed.status, 503);
  assert.deepEqual(outcomes, ["FAILED"]);
  assert.equal(auditFailed.status, 503);
  assert.equal("error" in auditFailed.body ? auditFailed.body.error : "", "admin_audit_failed");
});
