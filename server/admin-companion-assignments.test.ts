import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminCompanionAssignment,
  type AdminCompanionAssignmentDependencies,
} from "./admin-companion-assignments.ts";

const APPOINTMENT_ID = "57a65052-f99e-50ab-9695-6c9c07289b92";
const MANAGER_ID = "cb5ac06d-eb00-5a81-b1e0-8fccbb55454a";
const ADMIN_ID = "5f0dcf7a-a842-4b79-985d-f94cf880db4a";
const SESSION_ID = "8d8fbac5-8eb1-5bb0-b584-b17919cacb7d";

const successDependencies: AdminCompanionAssignmentDependencies = {
  async verifyIdToken(token) {
    assert.equal(token, "firebase-token");
    return {uid: "admin-uid"};
  },
  async findAppUserByFirebaseUid(uid) {
    assert.equal(uid, "admin-uid");
    return {id: ADMIN_ID, role: "ADMIN"};
  },
  async assignCompanionSession(command) {
    assert.deepEqual(command, {
      appointmentRequestId: APPOINTMENT_ID,
      managerUserId: MANAGER_ID,
      actorAdminUserId: ADMIN_ID,
      expectedAppointmentVersion: 3,
      reason: "  담당 지역과 일치  ".trim(),
    });
    return SESSION_ID;
  },
};

const validBody = {
  appointmentRequestId: APPOINTMENT_ID,
  managerUserId: MANAGER_ID,
  expectedAppointmentVersion: 3,
  reason: "  담당 지역과 일치  ",
};

test("Authorization 헤더가 없으면 배정 함수를 호출하지 않고 401을 반환한다", async () => {
  let called = false;
  const result = await handleAdminCompanionAssignment(null, validBody, {
    ...successDependencies,
    async assignCompanionSession() {
      called = true;
      return SESSION_ID;
    },
  });

  assert.equal(result.status, 401);
  assert.equal(called, false);
});

test("PostgreSQL role이 ADMIN이 아니면 403을 반환한다", async () => {
  const result = await handleAdminCompanionAssignment("Bearer firebase-token", validBody, {
    ...successDependencies,
    async findAppUserByFirebaseUid() {
      return {id: MANAGER_ID, role: "MANAGER"};
    },
  });

  assert.equal(result.status, 403);
  assert.equal("error" in result.body ? result.body.error : "", "admin_role_required");
});

test("UUID와 예약 버전을 검증한다", async () => {
  const invalidUuid = await handleAdminCompanionAssignment("Bearer firebase-token", {
    ...validBody,
    appointmentRequestId: "not-a-uuid",
  }, successDependencies);
  const invalidVersion = await handleAdminCompanionAssignment("Bearer firebase-token", {
    ...validBody,
    expectedAppointmentVersion: -1,
  }, successDependencies);

  assert.equal(invalidUuid.status, 400);
  assert.equal(invalidVersion.status, 400);
});

test("관리자 요청은 actor ID를 포함해 배정 함수를 실행하고 201을 반환한다", async () => {
  const result = await handleAdminCompanionAssignment(
    "Bearer firebase-token",
    validBody,
    successDependencies,
  );

  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {sessionId: SESSION_ID});
});

for (const scenario of [
  {code: "22023", status: 400, error: "invalid_appointment_version"},
  {code: "23503", status: 400, error: "invalid_manager"},
  {code: "42501", status: 403, error: "admin_role_required"},
  {code: "P0002", status: 404, error: "appointment_not_found"},
  {code: "23505", status: 409, error: "assignment_already_exists"},
  {code: "40001", status: 409, error: "appointment_version_conflict"},
  {code: "P0001", status: 409, error: "appointment_state_conflict"},
  {code: "unexpected", status: 503, error: "companion_assignment_failed"},
]) {
  test(`DB 오류 ${scenario.code}를 공개 API 오류로 변환한다`, async () => {
    const result = await handleAdminCompanionAssignment("Bearer firebase-token", validBody, {
      ...successDependencies,
      async assignCompanionSession() {
        throw Object.assign(new Error("database detail must not escape"), {code: scenario.code});
      },
    });

    assert.equal(result.status, scenario.status);
    assert.equal("error" in result.body ? result.body.error : "", scenario.error);
    assert.equal(JSON.stringify(result.body).includes("database detail"), false);
  });
}
