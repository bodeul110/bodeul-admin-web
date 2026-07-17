import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAdminHospitalGuides,
  type AdminHospitalGuidesDependencies,
} from "./admin-hospital-guides.ts";

const successDependencies: AdminHospitalGuidesDependencies = {
  async verifyIdToken(token) {
    assert.equal(token, "firebase-token");
    return {uid: "admin-uid"};
  },
  async findRoleByFirebaseUid(uid) {
    assert.equal(uid, "admin-uid");
    return "ADMIN";
  },
  async listHospitalGuides(limit) {
    return [{
      id: "324431eb-8e0d-5427-bbb2-a31a71e6d7c4",
      hospitalName: "서울내과병원",
      departmentName: "내과",
      steps: [{order: 1, title: "환자 접수"}],
      createdAt: "2026-04-23T16:48:39.766Z",
      updatedAt: "2026-04-23T16:48:39.766Z",
    }].slice(0, limit);
  },
};

test("Authorization 헤더가 없으면 401을 반환한다", async () => {
  const result = await handleAdminHospitalGuides(null, null, successDependencies);

  assert.equal(result.status, 401);
  assert.deepEqual(result.body, {
    error: "missing_authorization",
    message: "Authorization 헤더가 필요합니다.",
  });
});

test("Firebase token이 잘못되면 401을 반환한다", async () => {
  const result = await handleAdminHospitalGuides("Bearer bad-token", null, {
    ...successDependencies,
    async verifyIdToken() {
      throw new Error("invalid token");
    },
  });

  assert.equal(result.status, 401);
  assert.equal("error" in result.body ? result.body.error : "", "invalid_firebase_token");
});

test("PostgreSQL role이 ADMIN이 아니면 403을 반환한다", async () => {
  const result = await handleAdminHospitalGuides("Bearer firebase-token", null, {
    ...successDependencies,
    async findRoleByFirebaseUid() {
      return "MANAGER";
    },
  });

  assert.equal(result.status, 403);
  assert.equal("error" in result.body ? result.body.error : "", "admin_role_required");
});

test("role 조회 실패는 503으로 구분한다", async () => {
  const result = await handleAdminHospitalGuides("Bearer firebase-token", null, {
    ...successDependencies,
    async findRoleByFirebaseUid() {
      throw new Error("db down");
    },
  });

  assert.equal(result.status, 503);
  assert.equal("error" in result.body ? result.body.error : "", "role_lookup_failed");
});

test("limit은 1부터 100 사이의 정수만 허용한다", async () => {
  const result = await handleAdminHospitalGuides("Bearer firebase-token", "101", successDependencies);

  assert.equal(result.status, 400);
  assert.equal("error" in result.body ? result.body.error : "", "invalid_limit");
});

test("관리자 요청은 기본 limit 50과 병원 가이드 목록을 반환한다", async () => {
  const result = await handleAdminHospitalGuides("Bearer firebase-token", null, successDependencies);

  assert.equal(result.status, 200);
  assert.equal("limit" in result.body ? result.body.limit : 0, 50);
  assert.equal("items" in result.body ? result.body.items[0]?.hospitalName : "", "서울내과병원");
});

test("병원 가이드 조회 실패는 503으로 구분한다", async () => {
  const result = await handleAdminHospitalGuides("Bearer firebase-token", "2", {
    ...successDependencies,
    async listHospitalGuides() {
      throw new Error("db down");
    },
  });

  assert.equal(result.status, 503);
  assert.equal("error" in result.body ? result.body.error : "", "hospital_guides_lookup_failed");
});
