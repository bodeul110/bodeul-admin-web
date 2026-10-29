export type ManagerListEnvironment = Readonly<Record<string, string | undefined>>;
export type ManagerListAuthMode = "legacy" | "json-reader";

const DEV_PROJECT_ID = "bodeul-dev";
const DEV_READER_EMAIL = "admin-manager-list-dev@bodeul-dev.iam.gserviceaccount.com";

export function resolveManagerListAuthMode(env: ManagerListEnvironment): ManagerListAuthMode {
  const mode = env.MANAGER_LIST_AUTH_MODE?.trim();
  if (!mode || mode === "legacy") return "legacy";
  if (mode === "json-reader") return mode;
  throw new Error("심사 목록 인증 모드 설정이 올바르지 않습니다.");
}

export function requireManagerListReaderCredential(env: ManagerListEnvironment): {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
} {
  if (resolveManagerListAuthMode(env) !== "json-reader"
      || env.VERCEL !== "1" || env.VERCEL_ENV !== "preview"
      || env.VERCEL_GIT_COMMIT_REF !== "dev"
      || env.FIREBASE_PROJECT_ID?.trim() !== DEV_PROJECT_ID) {
    throw new Error("심사 목록 전용 인증은 DEV Preview에서만 사용할 수 있습니다.");
  }
  let credential: unknown;
  try {
    credential = JSON.parse(env.FIREBASE_MANAGER_LIST_SERVICE_ACCOUNT_JSON || "");
  } catch {
    // JSON 파싱 오류에 비밀 값이 포함되지 않도록 원래 오류를 전달하지 않는다.
    throw credentialError();
  }
  if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
    throw credentialError();
  }
  const value = credential as Record<string, unknown>;
  if (value.type !== "service_account" || value.project_id !== DEV_PROJECT_ID
      || value.client_email !== DEV_READER_EMAIL || typeof value.private_key !== "string") {
    throw credentialError();
  }
  const privateKey = value.private_key.replace(/\\n/gu, "\n").trim();
  if (!privateKey.startsWith("-----BEGIN PRIVATE KEY-----\n")
      || !privateKey.endsWith("\n-----END PRIVATE KEY-----")) {
    throw credentialError();
  }
  return {projectId: DEV_PROJECT_ID, clientEmail: DEV_READER_EMAIL, privateKey};
}

function credentialError(): Error {
  return new Error("심사 목록 전용 서비스 계정 설정이 올바르지 않습니다.");
}
