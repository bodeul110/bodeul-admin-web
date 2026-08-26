import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeAdminAppCheck,
  resolveAdminAppCheckMode,
  resolveAllowedAppIds,
  type AdminAppCheckDependencies,
  type AdminAppCheckVerdict,
} from "./admin-app-check.ts";
import {classifyFirebaseAdminAppCheckError} from "./firebase-app-check-error.ts";

const WEB_APP_ID = "1:000000000000:web:production";

function dependencies(
  overrides: Partial<AdminAppCheckDependencies> = {},
): AdminAppCheckDependencies {
  return {
    mode: "enforce",
    allowedAppIds: new Set([WEB_APP_ID]),
    async verifyAppCheckToken(token) {
      if (token === "valid-token") {
        return {status: "valid", identity: {appId: WEB_APP_ID}};
      }
      if (token === "wrong-app-token") {
        return {status: "valid", identity: {appId: "1:000000000000:web:other"}};
      }
      return {status: "invalid"};
    },
    recordVerdict() {},
    ...overrides,
  };
}

test("off 모드는 App Check token 없이 요청을 허용한다", async () => {
  const result = await authorizeAdminAppCheck(null, dependencies({mode: "off"}));
  assert.equal(result, null);
});

test("observe 모드는 누락·위조 token을 기록하고 요청을 허용한다", async () => {
  const verdicts: AdminAppCheckVerdict[] = [];
  const deps = dependencies({
    mode: "observe",
    recordVerdict(verdict) {
      verdicts.push(verdict);
    },
  });

  assert.equal(await authorizeAdminAppCheck(null, deps), null);
  assert.equal(await authorizeAdminAppCheck("invalid-token", deps), null);
  assert.deepEqual(verdicts, ["missing", "invalid"]);
});

test("enforce 모드는 누락·위조 token을 거부한다", async () => {
  const missing = await authorizeAdminAppCheck(null, dependencies());
  const invalid = await authorizeAdminAppCheck("invalid-token", dependencies());

  assert.equal(missing?.status, 401);
  assert.equal(missing?.body.error, "missing_app_check");
  assert.equal(invalid?.status, 401);
  assert.equal(invalid?.body.error, "invalid_app_check");
});

test("enforce 모드는 다른 Firebase Web 앱의 token을 거부한다", async () => {
  const result = await authorizeAdminAppCheck("wrong-app-token", dependencies());

  assert.equal(result?.status, 403);
  assert.equal(result?.body.error, "app_check_app_not_allowed");
});

test("허용된 Web 앱의 정상 token은 통과한다", async () => {
  const verdicts: AdminAppCheckVerdict[] = [];
  const result = await authorizeAdminAppCheck("valid-token", dependencies({
    recordVerdict(verdict) {
      verdicts.push(verdict);
    },
  }));

  assert.equal(result, null);
  assert.deepEqual(verdicts, ["valid"]);
});

test("enforce 설정에 허용 앱 ID가 없으면 503으로 실패한다", async () => {
  const result = await authorizeAdminAppCheck("valid-token", dependencies({
    allowedAppIds: new Set(),
  }));

  assert.equal(result?.status, 503);
  assert.equal(result?.body.error, "app_check_not_configured");
});

test("enforce 모드는 검증 서비스 장애와 서버 설정 오류를 503으로 구분한다", async () => {
  const unavailable = await authorizeAdminAppCheck("token", dependencies({
    async verifyAppCheckToken() {
      return {status: "unavailable"};
    },
  }));
  const misconfigured = await authorizeAdminAppCheck("token", dependencies({
    async verifyAppCheckToken() {
      return {status: "misconfigured"};
    },
  }));

  assert.equal(unavailable?.status, 503);
  assert.equal(unavailable?.body.error, "app_check_unavailable");
  assert.equal(misconfigured?.status, 503);
  assert.equal(misconfigured?.body.error, "app_check_not_configured");
});

test("Firebase Admin 오류는 token 오류와 서버 장애를 구분한다", () => {
  assert.equal(classifyFirebaseAdminAppCheckError({
    code: "app-check/invalid-argument",
    message: "Decoding App Check token failed.",
  }), "invalid");
  assert.equal(classifyFirebaseAdminAppCheckError({
    code: "app-check/app-check-token-expired",
    message: "expired",
  }), "invalid");
  assert.equal(classifyFirebaseAdminAppCheckError({
    code: "app-check/invalid-argument",
    message: "Error fetching public keys for Google certs",
  }), "unavailable");
  assert.equal(classifyFirebaseAdminAppCheckError({
    code: "app-check/invalid-credential",
    message: "project id missing",
  }), "misconfigured");
});

test("모드와 허용 앱 ID 환경값을 엄격하게 해석한다", () => {
  assert.equal(resolveAdminAppCheckMode(undefined), "observe");
  assert.equal(resolveAdminAppCheckMode(" OBSERVE "), "observe");
  assert.throws(() => resolveAdminAppCheckMode("enabled"));
  assert.deepEqual([...resolveAllowedAppIds(` ${WEB_APP_ID},,other-app `)], [WEB_APP_ID, "other-app"]);
});
