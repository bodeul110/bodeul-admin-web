import type {AdminFailure} from "./admin-auth.ts";

export type AdminAppCheckMode = "off" | "observe" | "enforce";

export type VerifiedAppCheckIdentity = {
  readonly appId: string;
};

export type AdminAppCheckVerdict =
  | "disabled"
  | "valid"
  | "missing"
  | "invalid"
  | "unavailable"
  | "wrong_app"
  | "misconfigured";

export type AdminAppCheckVerificationResult =
  | {readonly status: "valid"; readonly identity: VerifiedAppCheckIdentity}
  | {readonly status: "invalid" | "unavailable" | "misconfigured"};

export type AdminAppCheckDependencies = {
  readonly mode: AdminAppCheckMode;
  readonly allowedAppIds: ReadonlySet<string>;
  readonly verifyAppCheckToken: (token: string) => Promise<AdminAppCheckVerificationResult>;
  readonly recordVerdict: (verdict: AdminAppCheckVerdict, mode: AdminAppCheckMode) => void;
};

export async function authorizeAdminAppCheck(
  appCheckHeader: string | null,
  dependencies: AdminAppCheckDependencies,
): Promise<AdminFailure | null> {
  if (dependencies.mode === "off") {
    dependencies.recordVerdict("disabled", dependencies.mode);
    return null;
  }

  if (dependencies.allowedAppIds.size === 0) {
    dependencies.recordVerdict("misconfigured", dependencies.mode);
    return dependencies.mode === "enforce"
      ? failure(503, "app_check_not_configured", "관리자 웹 App Check 설정을 확인해 주세요.")
      : null;
  }

  const token = appCheckHeader?.trim() || "";
  if (!token) {
    dependencies.recordVerdict("missing", dependencies.mode);
    return dependencies.mode === "enforce"
      ? failure(401, "missing_app_check", "App Check token이 필요합니다.")
      : null;
  }

  let verification: AdminAppCheckVerificationResult;
  try {
    verification = await dependencies.verifyAppCheckToken(token);
  } catch {
    verification = {status: "unavailable"};
  }

  if (verification.status !== "valid") {
    dependencies.recordVerdict(verification.status, dependencies.mode);
    if (dependencies.mode !== "enforce") {
      return null;
    }

    if (verification.status === "invalid") {
      return failure(401, "invalid_app_check", "App Check token 검증에 실패했습니다.");
    }
    if (verification.status === "misconfigured") {
      return failure(503, "app_check_not_configured", "관리자 웹 App Check 설정을 확인해 주세요.");
    }
    return failure(503, "app_check_unavailable", "App Check token 검증 서비스를 사용할 수 없습니다.");
  }

  if (!dependencies.allowedAppIds.has(verification.identity.appId)) {
    dependencies.recordVerdict("wrong_app", dependencies.mode);
    return dependencies.mode === "enforce"
      ? failure(403, "app_check_app_not_allowed", "허용된 관리자 웹 App Check token이 아닙니다.")
      : null;
  }

  dependencies.recordVerdict("valid", dependencies.mode);
  return null;
}

export function resolveAdminAppCheckMode(rawMode: string | undefined): AdminAppCheckMode {
  const mode = rawMode?.trim().toLowerCase() || "observe";
  if (mode === "off" || mode === "observe" || mode === "enforce") {
    return mode;
  }

  throw new Error("ADMIN_APP_CHECK_MODE는 off, observe, enforce 중 하나여야 합니다.");
}

export function resolveAllowedAppIds(rawAppIds: string | undefined): ReadonlySet<string> {
  return new Set(
    (rawAppIds || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function failure(status: number, error: string, message: string): AdminFailure {
  return {
    status,
    body: {error, message},
  };
}
