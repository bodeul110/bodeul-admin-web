import assert from "node:assert/strict";
import test from "node:test";
import {handleListManagerReviews, type AdminManagerReviewDependencies} from "./admin-manager-reviews.ts";
import {createManagerListDependencies} from "./manager-list-dependencies.ts";
import {requireManagerListReaderCredential} from "./manager-list-reader-policy.ts";

function syntheticDependencies(overrides: Partial<AdminManagerReviewDependencies> = {}) {
  const events: string[] = [];
  const unused = async () => {events.push("unexpected-write-or-document"); throw new Error("호출하지 않아야 합니다.");};
  const dependencies: AdminManagerReviewDependencies = {
    mode: "off", allowedAppIds: new Set(), mfaMode: "enforce",
    async verifyAppCheckToken() {throw new Error("App Check off 상태입니다.");},
    recordVerdict() {},
    async verifyIdToken() {events.push("verify-id"); return {uid: "synthetic-admin", mfaVerified: true};},
    async findAppUserByFirebaseUid() {
      events.push("role-lookup");
      return {id: "synthetic-admin-id", role: "ADMIN", adminRole: "OPERATIONS", breakGlassExpiresAt: null};
    },
    async listManagerReviews() {events.push("legacy-list"); return [];},
    saveManagerReview: unused, verifyManagerDocumentEvidenceTokens: unused,
    getManagerReviewOutboxHmacKey() {events.push("unexpected-hmac-read"); throw new Error();},
    markManagerReviewAuditDelivered: unused, loadManagerDocument: unused,
    async reconcilePendingManagerReviewAudits() {events.push("legacy-outbox"); return 1;},
    async recordAdminAccessAudit(command) {events.push(`pg-audit:${command.outcome}`); return "synthetic-audit-id";},
    ...overrides,
  };
  return {dependencies, events};
}

test("전용 reader GET은 목록·필수 PG 감사를 유지하며 outbox·HMAC·서류·쓰기를 호출하지 않는다", async () => {
  const {dependencies, events} = syntheticDependencies();
  const selected = createManagerListDependencies(dependencies, {MANAGER_LIST_AUTH_MODE: "json-reader"}, async () => {
    events.push("reader-list");
    return [{id: "synthetic-manager", name: "합*", maskedEmail: "sy***@example.invalid", maskedPhone: "-",
      createdAt: "", status: "PENDING", documentSummary: "", reviewNote: "",
      availableDocumentKeys: [], submissionRevision: ""}];
  });
  const result = await handleListManagerReviews("Bearer synthetic-token", null, selected);
  assert.equal(result.status, 200);
  assert.equal("items" in result.body && result.body.items.length, 1);
  assert.deepEqual(events, ["verify-id", "role-lookup", "reader-list", "pg-audit:ALLOWED"]);
  assert.equal(selected.saveManagerReview, dependencies.saveManagerReview);
  assert.equal(selected.loadManagerDocument, dependencies.loadManagerDocument);
  assert.equal(selected.verifyIdToken, dependencies.verifyIdToken);
  assert.equal(dependencies.reconcilePendingManagerReviewAudits === selected.reconcilePendingManagerReviewAudits, false);
});

test("기본·명시적 legacy GET은 기존 목록과 outbox 경로를 유지한다", async () => {
  for (const env of [{}, {MANAGER_LIST_AUTH_MODE: "legacy"}]) {
    const {dependencies, events} = syntheticDependencies();
    const selected = createManagerListDependencies(dependencies, env, async () => {throw new Error("reader 호출 금지");});
    const result = await handleListManagerReviews("Bearer synthetic-token", null, selected);
    assert.equal(result.status, 200);
    assert.deepEqual(events, ["verify-id", "role-lookup", "legacy-outbox", "legacy-list", "pg-audit:ALLOWED"]);
  }
});

test("누락된 전용 credential은 legacy로 재시도하거나 빈 목록을 반환하지 않고 FAILED 감사와 503을 유지한다", async () => {
  const {dependencies, events} = syntheticDependencies();
  const env = {MANAGER_LIST_AUTH_MODE: "json-reader", VERCEL: "1", VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "dev", FIREBASE_PROJECT_ID: "bodeul-dev"};
  const selected = createManagerListDependencies(dependencies, env, async () => {
    events.push("reader-list"); requireManagerListReaderCredential(env); return [];
  });
  const result = await handleListManagerReviews("Bearer synthetic-token", null, selected);
  assert.equal(result.status, 503);
  assert.equal("items" in result.body, false);
  assert.deepEqual(events, ["verify-id", "role-lookup", "reader-list", "pg-audit:FAILED"]);
});

test("잘못된 인증 모드는 outbox나 legacy 목록을 호출하지 않는다", async () => {
  const {dependencies, events} = syntheticDependencies();
  const selected = createManagerListDependencies(dependencies, {MANAGER_LIST_AUTH_MODE: "invalid"}, async () => {
    events.push("reader-list"); return [];
  });
  const result = await handleListManagerReviews("Bearer synthetic-token", null, selected);
  assert.equal(result.status, 503);
  assert.equal("items" in result.body, false);
  assert.deepEqual(events, ["verify-id", "role-lookup", "pg-audit:FAILED"]);
});

test("reader 또는 필수 PG 감사 실패는 비밀 없는 503으로 종료한다", async () => {
  const secretSentinel = "synthetic-secret-not-for-response";
  for (const failAudit of [false, true]) {
    const audits: string[] = [];
    const {dependencies, events} = syntheticDependencies({async recordAdminAccessAudit(command) {
      audits.push(command.outcome);
      if (failAudit) throw new Error(secretSentinel);
      return "synthetic-audit-id";
    }});
    const selected = createManagerListDependencies(dependencies, {MANAGER_LIST_AUTH_MODE: "json-reader"}, async () => {
      events.push("reader-list");
      if (!failAudit) throw new Error(secretSentinel);
      return [];
    });
    const result = await handleListManagerReviews("Bearer synthetic-token", null, selected);
    assert.equal(result.status, 503);
    assert.equal("items" in result.body, false);
    assert.equal(JSON.stringify(result).includes(secretSentinel), false);
    assert.deepEqual(audits, failAudit ? ["ALLOWED", "FAILED"] : ["FAILED"]);
    assert.equal(events.includes("legacy-list") || events.includes("legacy-outbox"), false);
  }
});

test("인증·MFA·App Check·역할 거부는 모드/credential 선택보다 먼저 적용한다", async () => {
  const cases: {overrides: Partial<AdminManagerReviewDependencies>; header: string | null; status: number}[] = [
    {overrides: {}, header: null, status: 401},
    {overrides: {async verifyIdToken() {throw new Error("합성 token 거부");}}, header: "Bearer synthetic", status: 401},
    {overrides: {async verifyIdToken() {return {uid: "synthetic", mfaVerified: false};}}, header: "Bearer synthetic", status: 401},
    {overrides: {mode: "enforce", allowedAppIds: new Set(["synthetic-app"])}, header: "Bearer synthetic", status: 401},
    {overrides: {mode: "enforce"}, header: "Bearer synthetic", status: 503},
    {overrides: {async findAppUserByFirebaseUid() {
      return {id: "synthetic", role: "ADMIN", adminRole: "DEVELOPER", breakGlassExpiresAt: null};
    }}, header: "Bearer synthetic", status: 403},
    {overrides: {async findAppUserByFirebaseUid() {throw new Error("합성 PG 인증 실패");}}, header: "Bearer synthetic", status: 503},
  ];
  for (const scenario of cases) {
    const {dependencies, events} = syntheticDependencies(scenario.overrides);
    const env = {get MANAGER_LIST_AUTH_MODE(): string {throw new Error("인증 전에 모드를 읽으면 안 됩니다.");}};
    let readerCalls = 0;
    const selected = createManagerListDependencies(dependencies, env, async () => {readerCalls += 1; return [];});
    const result = await handleListManagerReviews(scenario.header, null, selected);
    assert.equal(result.status, scenario.status);
    assert.equal(readerCalls, 0);
    assert.equal(events.includes("legacy-list") || events.includes("legacy-outbox"), false);
  }
});

test("역할 거부의 필수 PG 감사 실패도 reader를 호출하지 않고 503으로 종료한다", async () => {
  const {dependencies} = syntheticDependencies({
    async findAppUserByFirebaseUid() {
      return {id: "synthetic", role: "ADMIN", adminRole: "DEVELOPER", breakGlassExpiresAt: null};
    },
    async recordAdminAccessAudit() {throw new Error("합성 감사 실패");},
  });
  let calls = 0;
  const selected = createManagerListDependencies(dependencies, {MANAGER_LIST_AUTH_MODE: "json-reader"}, async () => {
    calls += 1; return [];
  });
  const result = await handleListManagerReviews("Bearer synthetic-token", null, selected);
  assert.equal(result.status, 503);
  assert.equal(calls, 0);
});
