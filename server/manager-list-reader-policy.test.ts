import assert from "node:assert/strict";
import test from "node:test";
import {Firestore} from "firebase-admin/firestore";
import {ExternalAccountClient, GoogleAuth} from "google-auth-library";
import {
  createManagerListOidcOptions,
  requireManagerListOidcConfiguration,
  resolveManagerListAuthMode,
  type ManagerListEnvironment,
} from "./manager-list-reader-policy.ts";

const syntheticEnv: ManagerListEnvironment = {
  MANAGER_LIST_AUTH_MODE: "vercel-oidc", VERCEL: "1", VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "dev", FIREBASE_PROJECT_ID: "bodeul-dev",
};
const productionEnv: ManagerListEnvironment = {
  MANAGER_LIST_AUTH_MODE: "vercel-oidc", VERCEL: "1", VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_REF: "master", FIREBASE_PROJECT_ID: "bodeul-prod-110",
};

test("기본 legacy를 유지하고 폐기한 JSON reader와 알 수 없는 모드는 거부한다", () => {
  assert.equal(resolveManagerListAuthMode({}), "legacy");
  assert.equal(resolveManagerListAuthMode({MANAGER_LIST_AUTH_MODE: " legacy "}), "legacy");
  assert.equal(resolveManagerListAuthMode(syntheticEnv), "vercel-oidc");
  for (const mode of ["json-reader", "reader-typo"]) {
    assert.throws(() => resolveManagerListAuthMode({MANAGER_LIST_AUTH_MODE: mode}));
  }
});

test("개발 OIDC reader는 Preview/dev와 개발 프로젝트가 모두 일치해야 한다", () => {
  for (const changes of [
    {MANAGER_LIST_AUTH_MODE: "legacy"}, {VERCEL: undefined}, {VERCEL: "0"},
    {VERCEL_ENV: "production"}, {VERCEL_ENV: "development"},
    {VERCEL_GIT_COMMIT_REF: undefined}, {VERCEL_GIT_COMMIT_REF: "feature/example"},
    {FIREBASE_PROJECT_ID: undefined}, {FIREBASE_PROJECT_ID: "bodeul-prod-110"},
  ]) {
    assert.throws(() => requireManagerListOidcConfiguration({...syntheticEnv, ...changes}));
  }
  const config = requireManagerListOidcConfiguration(syntheticEnv);
  assert.equal(config.projectId, "bodeul-dev");
  assert.equal(config.serviceAccountEmail, "admin-manager-list-dev@bodeul-dev.iam.gserviceaccount.com");
});

test("운영 OIDC reader는 Production/master와 운영 프로젝트가 모두 일치해야 한다", () => {
  const config = requireManagerListOidcConfiguration(productionEnv);
  assert.equal(config.projectId, "bodeul-prod-110");
  assert.equal(config.serviceAccountEmail, "admin-manager-list-prod@bodeul-prod-110.iam.gserviceaccount.com");
  assert.equal(config.provider, "projects/649312328770/locations/global/workloadIdentityPools/vercel-admin-production/providers/vercel");
  for (const changes of [
    {MANAGER_LIST_AUTH_MODE: "legacy"}, {VERCEL: undefined}, {VERCEL: "0"},
    {VERCEL_ENV: "preview"}, {VERCEL_ENV: "development"},
    {VERCEL_GIT_COMMIT_REF: undefined}, {VERCEL_GIT_COMMIT_REF: "dev"},
    {VERCEL_GIT_COMMIT_REF: "feature/example"}, {FIREBASE_PROJECT_ID: undefined},
    {FIREBASE_PROJECT_ID: "bodeul-dev"},
  ]) {
    assert.throws(() => requireManagerListOidcConfiguration({...productionEnv, ...changes}));
  }
});

test("운영 token은 운영 provider와 전용 계정으로만 교환하며 개발 신원과 섞이지 않는다", () => {
  const options = createManagerListOidcOptions(productionEnv, async () => "synthetic-production-assertion");
  assert.equal(options.audience, "//iam.googleapis.com/projects/649312328770/locations/global/workloadIdentityPools/vercel-admin-production/providers/vercel");
  assert.equal(options.service_account_impersonation_url,
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/admin-manager-list-prod@bodeul-prod-110.iam.gserviceaccount.com:generateAccessToken");
  assert.deepEqual(options.scopes, ["https://www.googleapis.com/auth/datastore"]);
  assert.deepEqual(options.service_account_impersonation, {token_lifetime_seconds: 600});
  assert.equal(options.credential_source, undefined);
  assert.doesNotMatch(JSON.stringify(options), /bodeul-dev|vercel-admin-preview|533563500316/u);
});

test("토큰 교환·대상 계정·범위는 고정하고 JSON 키와 임의 URL은 사용하지 않는다", () => {
  const options = createManagerListOidcOptions({...syntheticEnv,
    FIREBASE_SERVICE_ACCOUNT_JSON: "private-sentinel",
    GOOGLE_APPLICATION_CREDENTIALS: "untrusted.json",
  }, async () => "synthetic-assertion");
  assert.equal(options.type, "external_account");
  assert.equal(options.audience, "//iam.googleapis.com/projects/533563500316/locations/global/workloadIdentityPools/vercel-admin-preview/providers/vercel");
  assert.equal(options.token_url, "https://sts.googleapis.com/v1/token");
  assert.equal(options.service_account_impersonation_url,
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/admin-manager-list-dev@bodeul-dev.iam.gserviceaccount.com:generateAccessToken");
  assert.deepEqual(options.scopes, ["https://www.googleapis.com/auth/datastore"]);
  assert.deepEqual(options.service_account_impersonation, {token_lifetime_seconds: 600});
  assert.equal(options.credential_source, undefined);
  assert.doesNotMatch(JSON.stringify(options), /private-sentinel|untrusted.json/u);
});

test("OIDC supplier는 현재 token을 매번 읽으며 실패 시 다른 신원으로 재시도하지 않는다", async () => {
  let calls = 0;
  const options = createManagerListOidcOptions(syntheticEnv, async (...args: unknown[]) => {
    // Google 교환 audience를 Vercel의 사용자 지정 audience로 전달하면 안 된다.
    assert.deepEqual(args, []);
    return `synthetic-${++calls}`;
  });
  const supplier = options.subject_token_supplier!;
  const context = {audience: options.audience, subjectTokenType: options.subject_token_type,
    transporter: ExternalAccountClient.fromJSON(options)!.transporter};
  assert.equal(await supplier.getSubjectToken(context), "synthetic-1");
  assert.equal(await supplier.getSubjectToken(context), "synthetic-2");
  const failed = createManagerListOidcOptions(syntheticEnv, async () => {throw new Error("synthetic failure");});
  await assert.rejects(() => failed.subject_token_supplier!.getSubjectToken(context), /synthetic failure/u);
});

test("현재 공식 SDK로 외부 계정과 별도 Firestore client를 클라우드 요청 없이 구성한다", async () => {
  let calls = 0;
  const client = ExternalAccountClient.fromJSON(createManagerListOidcOptions(syntheticEnv, async () => {
    calls += 1;
    throw new Error("구성 검증에서 token을 요청하면 안 됩니다.");
  }));
  assert.ok(client);
  const auth = new GoogleAuth({projectId: "bodeul-dev", authClient: client});
  assert.equal(await auth.getClient(), client);
  const firestore = new Firestore({projectId: "bodeul-dev", databaseId: "(default)", preferRest: true, auth});
  try {
    assert.equal(firestore.databaseId, "(default)");
    assert.equal(firestore.doc("users/synthetic-manager").path, "users/synthetic-manager");
    assert.equal(calls, 0);
  } finally {
    await firestore.terminate();
  }
});
