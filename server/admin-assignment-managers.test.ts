import assert from "node:assert/strict";
import test from "node:test";
import {handleAssignmentManagers, type AssignmentManagerDependencies} from "./admin-assignment-managers.ts";
import {appointmentVersion, assignedManagerLabel, assignmentManagerLabel, canAssignManager, parseAssignmentManagers} from "../src/adminAssignment.ts";

const manager = {id: "cb5ac06d-eb00-5a81-b1e0-8fccbb55454a", name: "시연 매니저", email: "manager@example.invalid"};
const deps: AssignmentManagerDependencies = {
  mode: "off", allowedAppIds: new Set(), recordVerdict() {},
  async verifyAppCheckToken() { return {status: "invalid"}; },
  async verifyIdToken() { return {uid: "admin-uid"}; },
  async findAppUserByFirebaseUid() { return {id: "admin-id", role: "ADMIN", adminRole: "OPERATIONS", breakGlassExpiresAt: null}; },
  async listAssignmentManagers(query) { assert.equal(query, "시연"); return {items: [manager], hasMore: false}; },
};

test("운영 관리자는 정규화된 검색어로 후보를 읽는다", async () => {
  const result = await handleAssignmentManagers("Bearer test", null, " 시연 ", deps);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {items: [manager], hasMore: false});
});

for (const role of ["PATIENT", "MANAGER", "DEVELOPER"] as const) {
  test(`${role}는 후보 DB 조회 전에 차단한다`, async () => {
    let called = false;
    const result = await handleAssignmentManagers("Bearer test", null, "", {...deps,
      async findAppUserByFirebaseUid() { return {id: "user", role: role === "DEVELOPER" ? "ADMIN" : role,
        adminRole: role === "DEVELOPER" ? "DEVELOPER" : null, breakGlassExpiresAt: null}; },
      async listAssignmentManagers() { called = true; return {items: [], hasMore: false}; },
    });
    assert.equal(result.status, 403);
    assert.equal(called, false);
  });
}

test("인증·App Check·MFA 실패 시 후보를 읽지 않는다", async () => {
  let called = false;
  const guarded = {...deps, async listAssignmentManagers() { called = true; return {items: [], hasMore: false}; }};
  assert.equal((await handleAssignmentManagers(null, null, "", guarded)).status, 401);
  assert.equal((await handleAssignmentManagers("Bearer test", "bad", "", {...guarded, mode: "enforce", allowedAppIds: new Set(["test-app"])})).status, 401);
  assert.equal((await handleAssignmentManagers("Bearer test", null, "", {...guarded, mfaMode: "enforce"})).status, 401);
  assert.equal(called, false);
});

test("검색 길이를 제한하고 DB 오류의 내부 정보는 노출하지 않는다", async () => {
  assert.equal((await handleAssignmentManagers("Bearer test", null, "x".repeat(101), deps)).status, 400);
  const result = await handleAssignmentManagers("Bearer test", null, "", {...deps,
    async listAssignmentManagers() { throw new Error("private connection string"); },
  });
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(result.body), /private/u);
});

test("후보 응답은 정상 UUID·문자열·50명 제한을 검증한다", () => {
  assert.deepEqual(parseAssignmentManagers({items: [manager], hasMore: false}), {items: [manager], hasMore: false});
  assert.throws(() => parseAssignmentManagers({items: [{...manager, id: "uid-not-uuid"}], hasMore: false}));
  assert.throws(() => parseAssignmentManagers({items: Array(51).fill(manager), hasMore: true}));
  assert.throws(() => parseAssignmentManagers({items: [manager]}));
});

test("미배정 요청 상태와 안전한 버전만 신규 배정할 수 있다", () => {
  const item = {status: "REQUESTED", managerUserId: "", version: 0};
  assert.equal(canAssignManager(item), true);
  for (const status of ["MATCHED", "IN_PROGRESS", "COMPLETED", "CANCELED"]) assert.equal(canAssignManager({...item, status}), false);
  assert.equal(canAssignManager({...item, managerUserId: manager.id}), false);
  assert.equal(canAssignManager({...item, version: -1}), false);
  assert.equal(canAssignManager({...item, version: Number.NaN}), false);
  assert.equal(appointmentVersion(0), 0);
  for (const value of [null, undefined, "0", -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => appointmentVersion(value));
});

test("이름이 없어도 배정된 매니저를 미배정으로 표시하지 않는다", () => {
  assert.equal(assignedManagerLabel({managerUserId: "", managerName: ""}), "미배정");
  assert.match(assignedManagerLabel({managerUserId: manager.id, managerName: ""}), /이름 미등록/u);
  assert.equal(assignmentManagerLabel({...manager, name: ""}), manager.email);
});
