import {
  authorizeAdminAppCheck,
  type AdminAppCheckDependencies,
} from "./admin-app-check.ts";

export type AppUserRole = "PATIENT" | "GUARDIAN" | "MANAGER" | "ADMIN";
export type AdminDetailRole = "SUPER_ADMIN" | "OPERATIONS" | "DEVELOPER";

export type VerifiedFirebaseIdentity = {
  readonly uid: string;
  readonly mfaVerified?: boolean;
};

export type AdminMfaMode = "off" | "observe" | "enforce";

export type AppUserIdentity = {
  readonly id: string;
  readonly role: AppUserRole;
  readonly adminRole: AdminDetailRole | null;
  readonly breakGlassExpiresAt: string | null;
};

export type AdminErrorBody = {
  readonly error: string;
  readonly message: string;
};

export type AdminFailure = {
  readonly status: number;
  readonly body: AdminErrorBody;
};

export type AdminAuthorizationDependencies = AdminAppCheckDependencies & {
  readonly verifyIdToken: (token: string) => Promise<VerifiedFirebaseIdentity>;
  readonly findAppUserByFirebaseUid: (uid: string) => Promise<AppUserIdentity | null>;
  readonly mfaMode?: AdminMfaMode;
  readonly recordMfaVerdict?: (verified: boolean, mode: AdminMfaMode) => void;
};

export type AdminAuthorizationResult =
  | {
    readonly ok: true;
    readonly actor: AppUserIdentity & {readonly firebaseUid: string};
  }
  | {
    readonly ok: false;
    readonly failure: AdminFailure;
  };

export async function authorizeAdmin(
  authorizationHeader: string | null,
  appCheckHeader: string | null,
  dependencies: AdminAuthorizationDependencies,
): Promise<AdminAuthorizationResult> {
  const tokenResult = extractBearerToken(authorizationHeader);
  if (!tokenResult.ok) {
    return tokenResult;
  }

  let identity: VerifiedFirebaseIdentity;
  try {
    identity = await dependencies.verifyIdToken(tokenResult.token);
  } catch {
    return authorizationFailure(401, "invalid_firebase_token", "Firebase ID token 검증에 실패했습니다.");
  }

  const firebaseUid = identity.uid.trim();
  if (!firebaseUid) {
    return authorizationFailure(401, "invalid_firebase_token", "Firebase ID token에 uid가 없습니다.");
  }

  const mfaMode = dependencies.mfaMode || "off";
  dependencies.recordMfaVerdict?.(identity.mfaVerified === true, mfaMode);
  if (mfaMode === "enforce" && identity.mfaVerified !== true) {
    return authorizationFailure(401, "admin_mfa_required", "관리자 계정은 다중 인증으로 다시 로그인해야 합니다.");
  }

  const appCheckFailure = await authorizeAdminAppCheck(appCheckHeader, dependencies);
  if (appCheckFailure) {
    return {ok: false, failure: appCheckFailure};
  }

  let appUser: AppUserIdentity | null;
  try {
    appUser = await dependencies.findAppUserByFirebaseUid(firebaseUid);
  } catch {
    return authorizationFailure(503, "role_lookup_failed", "관리자 권한 확인에 실패했습니다.");
  }

  if (appUser?.role !== "ADMIN") {
    return authorizationFailure(403, "admin_role_required", "관리자 권한이 필요합니다.");
  }

  if (!appUser.adminRole) {
    return authorizationFailure(403, "admin_detail_role_required", "활성 관리자 업무 역할이 필요합니다.");
  }

  return {
    ok: true,
    actor: {
      ...appUser,
      firebaseUid,
    },
  };
}

export function requireAdminRole(
  actor: AppUserIdentity,
  allowedRoles: readonly AdminDetailRole[],
): AdminFailure | null {
  if (!actor.adminRole || !allowedRoles.includes(actor.adminRole)) {
    return {
      status: 403,
      body: {
        error: "admin_detail_role_forbidden",
        message: "이 작업을 수행할 관리자 업무 권한이 없습니다.",
      },
    };
  }
  return null;
}

function extractBearerToken(authorizationHeader: string | null):
  | {readonly ok: true; readonly token: string}
  | {readonly ok: false; readonly failure: AdminFailure} {
  if (!authorizationHeader?.trim()) {
    return authorizationFailure(401, "missing_authorization", "Authorization 헤더가 필요합니다.");
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/iu);
  const token = match?.[1]?.trim() || "";
  if (!token) {
    return authorizationFailure(
      401,
      "invalid_authorization",
      "Authorization 헤더는 Bearer 토큰 형식이어야 합니다.",
    );
  }

  return {ok: true, token};
}

function authorizationFailure(status: number, error: string, message: string): {
  readonly ok: false;
  readonly failure: AdminFailure;
} {
  return {
    ok: false,
    failure: {
      status,
      body: {error, message},
    },
  };
}
