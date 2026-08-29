import assert from "node:assert/strict";
import test from "node:test";

import {handleAdminAudits, type AdminAuditsDependencies} from "./admin-audits.ts";

const ACTOR_ID = "5f0dcf7a-a842-4b79-985d-f94cf880db4a";

const dependencies: AdminAuditsDependencies = {
  mode: "off",
  allowedAppIds: new Set(),
  async verifyAppCheckToken() { throw new Error("호출되지 않아야 합니다."); },
  recordVerdict() {},
  async verifyIdToken() { return {uid: "admin-uid"}; },
  async findAppUserByFirebaseUid() {
    return {id: ACTOR_ID, role: "ADMIN", adminRole: "SUPER_ADMIN", breakGlassExpiresAt: null};
  },
  async listAdminAccessAudits(actorId, limit) {
    assert.deepEqual([actorId, limit], [ACTOR_ID, 50]);
    return [];
  },
};

test("SUPER_ADMIN은 기본 50건 감사 기록을 조회한다", async () => {
  const result = await handleAdminAudits("Bearer token", null, null, dependencies);
  assert.equal(result.status, 200);
  assert.equal("limit" in result.body ? result.body.limit : 0, 50);
});

test("감사 조회 limit과 역할을 제한한다", async () => {
  const invalidLimit = await handleAdminAudits("Bearer token", null, "201", dependencies);
  const developer = await handleAdminAudits("Bearer token", null, null, {
    ...dependencies,
    async findAppUserByFirebaseUid() {
      return {id: ACTOR_ID, role: "ADMIN", adminRole: "DEVELOPER", breakGlassExpiresAt: null};
    },
  });
  assert.equal(invalidLimit.status, 400);
  assert.equal(developer.status, 403);
});
