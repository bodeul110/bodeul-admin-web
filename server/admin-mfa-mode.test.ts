import assert from "node:assert/strict";
import test from "node:test";

import {resolveAdminMfaMode} from "./admin-mfa-mode.ts";

test("MFA 모드는 기본 observe이며 허용된 값만 사용한다", () => {
  assert.equal(resolveAdminMfaMode(undefined, undefined), "observe");
  assert.equal(resolveAdminMfaMode("off", undefined), "off");
  assert.throws(() => resolveAdminMfaMode("invalid", undefined), /off, observe, enforce/u);
});

test("MFA enforce는 전 관리자 등록과 복구 확인 플래그가 필요하다", () => {
  assert.throws(() => resolveAdminMfaMode("enforce", "false"), /ENFORCE_READY=true/u);
  assert.equal(resolveAdminMfaMode("enforce", "true"), "enforce");
});
