import assert from "node:assert/strict";
import test from "node:test";

import {createAdminApiHeaders} from "../src/adminApiHeaders.ts";

test("App Check token이 있으면 관리자 API 헤더에 전달한다", () => {
  assert.deepEqual(createAdminApiHeaders("firebase-token", "app-check-token"), {
    Authorization: "Bearer firebase-token",
    Accept: "application/json",
    "X-Firebase-AppCheck": "app-check-token",
  });
});

test("App Check token이 없으면 빈 헤더를 전송하지 않는다", () => {
  const headers = createAdminApiHeaders("firebase-token", null);

  assert.equal(headers.Authorization, "Bearer firebase-token");
  assert.equal("X-Firebase-AppCheck" in headers, false);
});
