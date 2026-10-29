import type {IdentityPoolClientOptions} from "google-auth-library";
import {ManagerReviewCredentialsError} from "./manager-review-credentials.ts";

export type ManagerListEnvironment = Readonly<Record<string, string | undefined>>;
export type ManagerListAuthMode = "legacy" | "vercel-oidc";

const DEV_PROJECT_ID = "bodeul-dev";
const DEV_READER_EMAIL = "admin-manager-list-dev@bodeul-dev.iam.gserviceaccount.com";
const DEV_PROVIDER = "projects/533563500316/locations/global/workloadIdentityPools/vercel-admin-preview/providers/vercel";

export function resolveManagerListAuthMode(env: ManagerListEnvironment): ManagerListAuthMode {
  const mode = env.MANAGER_LIST_AUTH_MODE?.trim();
  if (!mode || mode === "legacy") return "legacy";
  if (mode === "vercel-oidc") return mode;
  throw new ManagerReviewCredentialsError();
}

export function requireManagerListOidcConfiguration(env: ManagerListEnvironment) {
  if (resolveManagerListAuthMode(env) !== "vercel-oidc"
      || env.VERCEL !== "1" || env.VERCEL_ENV !== "preview"
      || env.VERCEL_GIT_COMMIT_REF !== "dev"
      || env.FIREBASE_PROJECT_ID?.trim() !== DEV_PROJECT_ID) {
    throw new ManagerReviewCredentialsError();
  }
  return {projectId: DEV_PROJECT_ID, serviceAccountEmail: DEV_READER_EMAIL, provider: DEV_PROVIDER};
}

export function createManagerListOidcOptions(
  env: ManagerListEnvironment,
  getSubjectToken: () => Promise<string>,
): IdentityPoolClientOptions {
  const config = requireManagerListOidcConfiguration(env);
  return {
    type: "external_account",
    audience: `//iam.googleapis.com/${config.provider}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    service_account_impersonation: {token_lifetime_seconds: 600},
    scopes: ["https://www.googleapis.com/auth/datastore"],
    // 요청마다 SDK가 제공하는 현재 OIDC token을 읽는다. token 자체를 캐시하지 않는다.
    subject_token_supplier: {getSubjectToken: () => getSubjectToken()},
  };
}
