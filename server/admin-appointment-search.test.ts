import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminAppointmentSearch,
  normalizePublicCode,
  type AdminAppointmentSearchDependencies,
} from "./admin-appointment-search.ts";

const ITEM = {
  id: "27bf3a07-6605-48ab-adbf-c7b18551a639",
  publicCode: "BD-ABC123",
  status: "MATCHED",
  appointmentAt: "2026-12-20T01:30:00.000Z",
  hospitalName: "서울대학교병원",
  departmentName: "내과",
  patientName: "환자 사용자",
  guardianName: "보호자 사용자",
  managerUserId: "04e9b7fd-9727-4f81-af7b-ab3534339fd0",
  managerName: "매니저 사용자",
} as const;

const dependencies: AdminAppointmentSearchDependencies = {
  mode: "off",
  allowedAppIds: new Set(),
  async verifyAppCheckToken() {
    throw new Error("off 모드에서는 호출되지 않아야 합니다.");
  },
  recordVerdict() {},
  async verifyIdToken() {
    return {uid: "admin-firebase-uid"};
  },
  async findAppUserByFirebaseUid() {
    return {id: "5f0dcf7a-a842-4b79-985d-f94cf880db4a", role: "ADMIN"};
  },
  async findAppointmentByPublicCode(actorAdminUserId, publicCode) {
    assert.equal(actorAdminUserId, "5f0dcf7a-a842-4b79-985d-f94cf880db4a");
    assert.equal(publicCode, "BD-ABC123");
    return {status: "FOUND", item: ITEM};
  },
};

test("예약 코드는 공백과 소문자를 정규화하되 부분 검색은 허용하지 않는다", () => {
  assert.equal(normalizePublicCode("  bd-abc123 "), "BD-ABC123");
  assert.equal(normalizePublicCode("ABC123"), null);
  assert.equal(normalizePublicCode("BD-ABC12"), null);
});

test("관리자만 정확 코드로 예약을 조회한다", async () => {
  const result = await handleAdminAppointmentSearch(
    "Bearer firebase-token",
    null,
    "bd-abc123",
    dependencies,
  );

  assert.equal(result.status, 200);
  assert.deepEqual("item" in result.body ? result.body.item : null, ITEM);
});

test("형식이 잘못된 코드는 데이터베이스를 호출하지 않는다", async () => {
  let lookupCalled = false;
  const result = await handleAdminAppointmentSearch(
    "Bearer firebase-token",
    null,
    "ABC",
    {
      ...dependencies,
      async findAppointmentByPublicCode() {
        lookupCalled = true;
        return {status: "NOT_FOUND", item: null};
      },
    },
  );

  assert.equal(result.status, 400);
  assert.equal(lookupCalled, false);
});

test("일치하는 예약이 없으면 404를 반환한다", async () => {
  const result = await handleAdminAppointmentSearch(
    "Bearer firebase-token",
    null,
    "BD-ABC123",
    {
      ...dependencies,
      async findAppointmentByPublicCode() {
        return {status: "NOT_FOUND", item: null};
      },
    },
  );

  assert.equal(result.status, 404);
  assert.equal("error" in result.body ? result.body.error : "", "appointment_not_found");
});

test("요청 제한에 걸리면 429를 반환한다", async () => {
  const result = await handleAdminAppointmentSearch(
    "Bearer firebase-token",
    null,
    "BD-ABC123",
    {
      ...dependencies,
      async findAppointmentByPublicCode() {
        return {status: "RATE_LIMITED", item: null};
      },
    },
  );

  assert.equal(result.status, 429);
  assert.equal("error" in result.body ? result.body.error : "", "public_code_rate_limited");
});

test("관리자가 아니면 검색 전에 거부한다", async () => {
  const result = await handleAdminAppointmentSearch(
    "Bearer firebase-token",
    null,
    "BD-ABC123",
    {
      ...dependencies,
      async findAppUserByFirebaseUid() {
        return {id: "manager-id", role: "MANAGER"};
      },
    },
  );

  assert.equal(result.status, 403);
});
